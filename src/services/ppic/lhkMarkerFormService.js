const db = require("../../config/database");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
// Lookup SPK/MAP generik dipakai bareng dengan LHK Pola — reuse
// supaya tidak duplikasi logic query yang sama persis.
const {
  searchSpk,
  getSpkByNomor,
  getDivisiNama,
  buildGambarFileName,
} = require("../garmen/lhkPolaFormService");

// --- GENERATE NOMOR (format: LHKM/0001/2026) ---
const generateNomor = async (tanggal) => {
  const tahun = new Date(tanggal).getFullYear();
  const [rows] = await db.query(
    `SELECT IFNULL(MAX(CAST(SUBSTR(lhkp_nomor, 6, 4) AS UNSIGNED)), 0) AS jumlah
     FROM tlhkpola_hdr
     WHERE lhkp_nomor LIKE 'LHKM/%' AND RIGHT(lhkp_nomor, 4) = ?`,
    [String(tahun)],
  );
  const nextVal = Number(rows[0].jumlah) + 1;
  return `LHKM/${String(nextVal).padStart(4, "0")}/${tahun}`;
};

const galat = (pesan, statusCode = 400) =>
  Object.assign(new Error(pesan), { statusCode });

// Nomor tanda terima: TTM.yyyymm.nnnn
const generateNomorTt = async (conn) => {
  const d = new Date();
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `TTM.${ym}.`;
  const [[r]] = await conn.query(
    `SELECT IFNULL(MAX(CAST(SUBSTR(tt_nomor, 12, 4) AS UNSIGNED)), 0) AS maks
       FROM tpermintaan_marker_tt WHERE tt_nomor LIKE ?`,
    [`${prefix}%`],
  );
  return `${prefix}${String(Number(r.maks) + 1).padStart(4, "0")}`;
};

// Satu tanda terima per pasangan (LHK, permintaan). Dipanggil di akhir
// transaksi saveData, idempoten: pasangan yang sudah punya tidak dibuat ulang.
const sinkronTandaTerima = async (conn, lhkNomor, pmList, userKode) => {
  const [lama] = await conn.query(
    `SELECT tt_nomor, tt_pm_nomor FROM tpermintaan_marker_tt WHERE tt_lhk_nomor = ?`,
    [lhkNomor],
  );
  const sudahAda = new Set(lama.map((r) => r.tt_pm_nomor));

  // Permintaan yang tidak lagi ada di LHK: tanda terimanya dihapus.
  // (Yang sudah divalidasi tidak sampai sini, LHK-nya sudah terkunci.)
  for (const r of lama) {
    if (!pmList.includes(r.tt_pm_nomor)) {
      await conn.query(`DELETE FROM tpermintaan_marker_tt WHERE tt_nomor = ?`, [
        r.tt_nomor,
      ]);
    }
  }

  // Isi dokumen berubah: Mutasi dikosongkan, dokumen harus dicetak ulang
  await conn.query(
    `UPDATE tpermintaan_marker_tt
        SET tt_date_mutasi = NULL, tt_user_mutasi = NULL
      WHERE tt_lhk_nomor = ?`,
    [lhkNomor],
  );

  for (const pm of pmList) {
    if (sudahAda.has(pm)) continue;
    const nomorTt = await generateNomorTt(conn);
    await conn.query(
      `INSERT INTO tpermintaan_marker_tt
         (tt_nomor, tt_lhk_nomor, tt_pm_nomor, tt_user_create, tt_date_create)
       VALUES (?, ?, ?, ?, NOW())`,
      [nomorTt, lhkNomor, pm, userKode],
    );
  }
};

// Data dokumen tanda terima satu LHK. Isi dibaca dari baris LHK, tidak disalin.
const bacaTandaTerima = async (executor, lhkNomor) => {
  const [[hdr]] = await executor.query(
    `SELECT lhkp_nomor AS nomor,
            DATE_FORMAT(lhkp_tanggal, '%Y-%m-%d') AS tanggal,
            lhkp_keterangan AS keterangan, lhkp_pembuat_marker AS pembuatMarker,
            user_create AS userCreate,
            DATE_FORMAT(date_create, '%Y-%m-%d %H:%i') AS dateCreate
       FROM tlhkpola_hdr WHERE lhkp_nomor = ?`,
    [lhkNomor],
  );
  if (!hdr) throw galat("Data LHK Marker tidak ditemukan.", 404);

  const [tandaTerima] = await executor.query(
    `SELECT t.tt_nomor AS nomor, t.tt_pm_nomor AS pmNomor,
            p.pm_user_create AS peminta,
            DATE_FORMAT(p.pm_deadline, '%Y-%m-%d') AS deadline,
            DATE_FORMAT(t.tt_date_mutasi, '%Y-%m-%d %H:%i') AS tglMutasi,
            t.tt_user_mutasi AS userMutasi,
            DATE_FORMAT(t.tt_date_terima, '%Y-%m-%d %H:%i') AS tglTerima,
            t.tt_user_terima AS userTerima
       FROM tpermintaan_marker_tt t
       INNER JOIN tpermintaan_marker p ON p.pm_nomor = t.tt_pm_nomor
      WHERE t.tt_lhk_nomor = ?
      ORDER BY t.tt_nomor`,
    [lhkNomor],
  );

  for (const t of tandaTerima) {
    const [baris] = await executor.query(
      `SELECT d.ldm_urut AS urut, d.ldm_spk_nomor AS spkNomor,
              IFNULL(s.spk_nama, m.mspk_nama) AS namaSpk,
              d.ldm_lebar_kain AS lebarKain, d.ldm_size AS size,
              d.ldm_tujuan_proses AS tujuanProses,
              d.ldm_keterangan AS keterangan, d.ldm_gambar AS gambar
         FROM tlhkpola_marker_dtl d
         LEFT JOIN tspk s ON s.spk_nomor = d.ldm_spk_nomor
         LEFT JOIN tmemospk m ON m.mspk_nomor = d.ldm_spk_nomor
        WHERE d.ldm_nomor = ? AND d.ldm_pm_nomor = ?
        ORDER BY d.ldm_urut`,
      [lhkNomor, t.pmNomor],
    );
    t.baris = baris;
  }
  return { lhk: hdr, tandaTerima };
};

// ============================================================
// GET DETAIL — untuk mode Ubah (hanya sisi Marker)
// ============================================================
const getDetail = async (nomor) => {
  const [headerRows] = await db.query(
    `SELECT * FROM tlhkpola_hdr WHERE lhkp_nomor = ?`,
    [nomor],
  );
  if (headerRows.length === 0)
    throw new Error("Data LHK Marker tidak ditemukan.");

  const [marker] = await db.query(
    `SELECT d.ldm_id AS id, d.ldm_urut AS urut, d.ldm_spk_nomor AS spkNomor,
            IFNULL(s.spk_nama, m.mspk_nama) AS namaSpk,
            d.ldm_lebar_kain AS lebarKain, d.ldm_size AS size,
            d.ldm_tujuan_proses AS tujuanProses,
            d.ldm_keterangan AS keterangan, d.ldm_gambar AS gambar,
            d.ldm_pm_nomor AS pmNomor
     FROM tlhkpola_marker_dtl d
     LEFT JOIN tspk s ON s.spk_nomor = d.ldm_spk_nomor
     LEFT JOIN tmemospk m ON m.mspk_nomor = d.ldm_spk_nomor
     WHERE d.ldm_nomor = ?
     ORDER BY d.ldm_urut`,
    [nomor],
  );

  return {
    header: {
      ...headerRows[0],
      pembuatMarker: headerRows[0].lhkp_pembuat_marker || "",
    },
    marker,
  };
};

// ============================================================
// SAVE DATA — create & edit (Marker saja)
// ============================================================
const saveData = async (payload, user, isEdit) => {
  const {
    nomor: existingNomor,
    tanggal,
    keterangan,
    pembuatMarker,
    marker,
  } = payload;

  if (!tanggal) throw new Error("Tanggal wajib diisi.");

  const markerFilled = (marker || []).filter(
    (r) => r.spkNomor && r.spkNomor.trim(),
  );
  if (markerFilled.length === 0) {
    throw new Error("Minimal harus ada 1 baris SPK terisi di Marker.");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // LHK terkunci bila menunjuk permintaan CLOSE (alur lama) atau bila salah
    // satu tanda terimanya sudah divalidasi pembuat permintaan
    if (isEdit && existingNomor) {
      const [terkunci] = await conn.query(
        `SELECT p.pm_nomor
           FROM tlhkpola_marker_dtl d
           INNER JOIN tpermintaan_marker p ON p.pm_nomor = d.ldm_pm_nomor
          WHERE d.ldm_nomor = ? AND p.pm_date_close IS NOT NULL
          LIMIT 1`,
        [existingNomor],
      );
      if (terkunci.length > 0) {
        throw new Error(
          `LHK ini terkait Permintaan Marker ${terkunci[0].pm_nomor} yang sudah CLOSE, tidak bisa diubah.`,
        );
      }
      const [sudahTerima] = await conn.query(
        `SELECT tt_nomor, tt_pm_nomor FROM tpermintaan_marker_tt
          WHERE tt_lhk_nomor = ? AND tt_date_terima IS NOT NULL LIMIT 1`,
        [existingNomor],
      );
      if (sudahTerima.length > 0) {
        throw new Error(
          `LHK ini sudah divalidasi pada tanda terima ${sudahTerima[0].tt_nomor} (Permintaan Marker ${sudahTerima[0].tt_pm_nomor}), tidak bisa diubah.`,
        );
      }
    }

    // Validasi sambungan ke Permintaan Marker (hanya baris yang mengirim pmNomor)
    for (const r of markerFilled) {
      const pm = String(r.pmNomor || "").trim();
      if (!pm) continue;
      const [[p]] = await conn.query(
        `SELECT pm_status_manual AS manual, pm_date_close AS closed
           FROM tpermintaan_marker WHERE pm_nomor = ?`,
        [pm],
      );
      if (!p) throw new Error(`Permintaan Marker ${pm} tidak ditemukan.`);
      if (p.manual) {
        throw new Error(`Permintaan Marker ${pm} berstatus ${p.manual}.`);
      }
      if (p.closed) throw new Error(`Permintaan Marker ${pm} sudah CLOSE.`);
      const [[ada]] = await conn.query(
        `SELECT COUNT(*) AS n FROM tpermintaan_marker_detail
          WHERE pm2_pm_nomor = ? AND pm2_spk_nomor = ?`,
        [pm, r.spkNomor],
      );
      if (!Number(ada.n)) {
        throw new Error(
          `SPK ${r.spkNomor} tidak ada di Permintaan Marker ${pm}.`,
        );
      }
      const [dup] = await conn.query(
        `SELECT ldm_nomor FROM tlhkpola_marker_dtl
          WHERE ldm_pm_nomor = ? AND ldm_spk_nomor = ? AND ldm_nomor <> ?
          LIMIT 1`,
        [pm, r.spkNomor, existingNomor || ""],
      );
      if (dup.length > 0) {
        throw new Error(
          `SPK ${r.spkNomor} di Permintaan Marker ${pm} sudah punya LHK ${dup[0].ldm_nomor}.`,
        );
      }
    }

    let nomor;
    if (isEdit) {
      if (!existingNomor) throw new Error("Nomor LHK Marker wajib diisi.");
      const [exist] = await conn.query(
        `SELECT lhkp_nomor FROM tlhkpola_hdr WHERE lhkp_nomor = ?`,
        [existingNomor],
      );
      if (exist.length === 0)
        throw new Error("Data LHK Marker tidak ditemukan.");
      nomor = existingNomor;
      await conn.query(
        `UPDATE tlhkpola_hdr
         SET lhkp_tanggal = ?, lhkp_keterangan = ?, lhkp_pembuat_marker = ?,
             user_modified = ?, date_modified = NOW()
         WHERE lhkp_nomor = ?`,
        [tanggal, keterangan || "", pembuatMarker || "", user.kode, nomor],
      );
    } else {
      nomor = await generateNomor(tanggal);
      await conn.query(
        `INSERT INTO tlhkpola_hdr
           (lhkp_nomor, lhkp_tanggal, lhkp_keterangan, lhkp_pembuat_marker, user_create, date_create)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [nomor, tanggal, keterangan || "", pembuatMarker || "", user.kode],
      );
    }

    // Gambar dan link permintaan lama dipulihkan per SPK karena baris dihapus lalu disisipkan ulang
    const [oldRows] = await conn.query(
      `SELECT ldm_spk_nomor AS spkNomor, ldm_gambar AS gambar, ldm_pm_nomor AS pmNomor
       FROM tlhkpola_marker_dtl WHERE ldm_nomor = ?`,
      [nomor],
    );
    const markerGambarMap = new Map(
      oldRows.filter((r) => r.gambar).map((r) => [r.spkNomor, r.gambar]),
    );
    const markerPmMap = new Map(
      oldRows.filter((r) => r.pmNomor).map((r) => [r.spkNomor, r.pmNomor]),
    );

    await conn.query(`DELETE FROM tlhkpola_marker_dtl WHERE ldm_nomor = ?`, [
      nomor,
    ]);
    const vals = markerFilled.map((r, i) => [
      nomor,
      i + 1,
      r.spkNomor,
      r.lebarKain || "",
      r.size || "",
      r.tujuanProses || "",
      r.keterangan || "",
      markerGambarMap.get(r.spkNomor) || null,
      // pmNomor tidak dikirim (form lama): pertahankan link lama; dikirim kosong: lepas link
      r.pmNomor === undefined
        ? markerPmMap.get(r.spkNomor) || null
        : String(r.pmNomor || "").trim() || null,
    ]);
    await conn.query(
      `INSERT INTO tlhkpola_marker_dtl
         (ldm_nomor, ldm_urut, ldm_spk_nomor, ldm_lebar_kain, ldm_size,
          ldm_tujuan_proses, ldm_keterangan, ldm_gambar, ldm_pm_nomor)
       VALUES ?`,
      [vals],
    );

    // Tanda terima per LHK dan permintaan, ikut transaksi ini (idempoten)
    const pmDipakai = [...new Set(vals.map((v) => v[8]).filter(Boolean))];
    await sinkronTandaTerima(conn, nomor, pmDipakai, user.kode);

    await conn.commit();
    return { nomor };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// ============================================================
// UPLOAD GAMBAR PER BARIS (khusus tab marker)
// ============================================================
const uploadGambarDetail = async (tempFilePath, lhkNomor, tab, spkNomor) => {
  if (!fs.existsSync(tempFilePath))
    throw new Error("File sumber sementara tidak ditemukan.");
  if (tab !== "marker") throw new Error("Tab tidak valid.");
  const [sudahTerima] = await db.query(
    `SELECT tt_nomor FROM tpermintaan_marker_tt
      WHERE tt_lhk_nomor = ? AND tt_date_terima IS NOT NULL LIMIT 1`,
    [lhkNomor],
  );
  if (sudahTerima.length > 0) {
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    throw new Error(
      `LHK Marker ${lhkNomor} sudah divalidasi, gambar tidak bisa diubah.`,
    );
  }

  const finalFileName = buildGambarFileName(lhkNomor, tab, spkNomor);
  const folderPath = path.join(process.cwd(), "public", "images", "lhkpola");
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
  const finalPath = path.join(folderPath, finalFileName);

  try {
    await sharp(tempFilePath)
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .toFormat("jpeg")
      .jpeg({ quality: 80 })
      .toFile(finalPath);
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
  } catch (error) {
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    throw new Error("Gagal memproses gambar ke format JPG.");
  }

  const [result] = await db.query(
    `UPDATE tlhkpola_marker_dtl SET ldm_gambar = ?
     WHERE ldm_nomor = ? AND ldm_spk_nomor = ?`,
    [finalFileName, lhkNomor, spkNomor],
  );
  if (result.affectedRows === 0) {
    throw new Error(
      `Baris SPK ${spkNomor} tidak ditemukan di marker untuk LHK Marker ${lhkNomor}.`,
    );
  }

  return finalFileName;
};

// ============================================================
// DELETE — hanya hapus marker + header. Grading (record lama
// gabungan) SENGAJA TIDAK disentuh.
// ============================================================
const deleteData = async (nomor) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [terkunci] = await conn.query(
      `SELECT p.pm_nomor
         FROM tlhkpola_marker_dtl d
         INNER JOIN tpermintaan_marker p ON p.pm_nomor = d.ldm_pm_nomor
        WHERE d.ldm_nomor = ? AND p.pm_date_close IS NOT NULL
        LIMIT 1`,
      [nomor],
    );
    if (terkunci.length > 0) {
      throw new Error(
        `LHK ini terkait Permintaan Marker ${terkunci[0].pm_nomor} yang sudah CLOSE, tidak bisa dihapus.`,
      );
    }

    const [sudahTerima] = await conn.query(
      `SELECT tt_nomor, tt_pm_nomor FROM tpermintaan_marker_tt
        WHERE tt_lhk_nomor = ? AND tt_date_terima IS NOT NULL LIMIT 1`,
      [nomor],
    );
    if (sudahTerima.length > 0) {
      throw new Error(
        `LHK ini sudah divalidasi pada tanda terima ${sudahTerima[0].tt_nomor} (Permintaan Marker ${sudahTerima[0].tt_pm_nomor}), tidak bisa dihapus.`,
      );
    }
    await conn.query(
      `DELETE FROM tpermintaan_marker_tt WHERE tt_lhk_nomor = ?`,
      [nomor],
    );

    await conn.query(`DELETE FROM tlhkpola_marker_dtl WHERE ldm_nomor = ?`, [
      nomor,
    ]);
    const [result] = await conn.query(
      `DELETE FROM tlhkpola_hdr WHERE lhkp_nomor = ?`,
      [nomor],
    );
    if (result.affectedRows === 0)
      throw new Error("Data LHK Marker tidak ditemukan.");
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// Pratinjau dokumen: tanpa efek samping (tidak mengisi Mutasi)
const getTandaTerima = (lhkNomor) => bacaTandaTerima(db, lhkNomor);

// Cetak: Mutasi diisi pada cetak pertama, cetak ulang tidak mengubahnya
const cetakTandaTerima = async (lhkNomor, user) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[ada]] = await conn.query(
      `SELECT COUNT(*) AS n FROM tpermintaan_marker_tt WHERE tt_lhk_nomor = ?`,
      [lhkNomor],
    );
    if (!Number(ada.n)) {
      throw galat(
        "LHK ini belum terkait Permintaan Marker, tidak ada tanda terima untuk dicetak.",
      );
    }
    await conn.query(
      `UPDATE tpermintaan_marker_tt
          SET tt_date_mutasi = NOW(), tt_user_mutasi = ?
        WHERE tt_lhk_nomor = ? AND tt_date_mutasi IS NULL`,
      [user.kode, lhkNomor],
    );
    const data = await bacaTandaTerima(conn, lhkNomor);
    await conn.commit();
    return data;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// Daftar tanda terima satu permintaan (dialog di browse Permintaan Marker)
const listTandaTerimaByPermintaan = async (pmNomor) => {
  const [rows] = await db.query(
    `SELECT t.tt_nomor AS nomor, t.tt_lhk_nomor AS lhkNomor,
            p.pm_user_create AS peminta,
            DATE_FORMAT(h.date_create, '%Y-%m-%d %H:%i') AS tglLhk,
            (SELECT GROUP_CONCAT(d.ldm_spk_nomor ORDER BY d.ldm_urut SEPARATOR ', ')
               FROM tlhkpola_marker_dtl d
              WHERE d.ldm_nomor = t.tt_lhk_nomor AND d.ldm_pm_nomor = t.tt_pm_nomor) AS spk,
            DATE_FORMAT(t.tt_date_mutasi, '%Y-%m-%d %H:%i') AS tglMutasi,
            t.tt_user_mutasi AS userMutasi,
            DATE_FORMAT(t.tt_date_terima, '%Y-%m-%d %H:%i') AS tglTerima,
            t.tt_user_terima AS userTerima
       FROM tpermintaan_marker_tt t
       INNER JOIN tpermintaan_marker p ON p.pm_nomor = t.tt_pm_nomor
       LEFT JOIN tlhkpola_hdr h ON h.lhkp_nomor = t.tt_lhk_nomor
      WHERE t.tt_pm_nomor = ?
      ORDER BY t.tt_nomor`,
    [pmNomor],
  );
  return rows;
};

// Validasi digital: hanya pembuat permintaan, setelah Mutasi terisi
const validasiTandaTerima = async (ttNomor, user) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[t]] = await conn.query(
      `SELECT t.tt_nomor, t.tt_pm_nomor, t.tt_date_mutasi, t.tt_date_terima,
              p.pm_user_create
         FROM tpermintaan_marker_tt t
         INNER JOIN tpermintaan_marker p ON p.pm_nomor = t.tt_pm_nomor
        WHERE t.tt_nomor = ?
        FOR UPDATE`,
      [ttNomor],
    );
    if (!t) throw galat("Tanda terima tidak ditemukan.", 404);
    if (
      String(t.pm_user_create).toUpperCase() !== String(user.kode).toUpperCase()
    ) {
      throw galat(
        `Hanya pembuat permintaan (${t.pm_user_create}) yang dapat memvalidasi tanda terima ini.`,
        403,
      );
    }
    if (t.tt_date_terima) throw galat("Tanda terima ini sudah divalidasi.");
    if (!t.tt_date_mutasi) {
      throw galat(
        "Tanda terima belum dicetak dan diserahkan oleh pembuat marker, belum bisa divalidasi.",
      );
    }
    await conn.query(
      `UPDATE tpermintaan_marker_tt
          SET tt_date_terima = NOW(), tt_user_terima = ?
        WHERE tt_nomor = ?`,
      [user.kode, ttNomor],
    );
    await conn.commit();
    return { nomor: ttNomor, pmNomor: t.tt_pm_nomor };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

module.exports = {
  getDetail,
  saveData,
  uploadGambarDetail,
  deleteData,
  searchSpk,
  getSpkByNomor,
  getDivisiNama,
  getTandaTerima,
  cetakTandaTerima,
  listTandaTerimaByPermintaan,
  validasiTandaTerima,
};
