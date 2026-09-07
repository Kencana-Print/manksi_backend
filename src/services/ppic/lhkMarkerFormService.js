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
            d.ldm_keterangan AS keterangan, d.ldm_gambar AS gambar
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

    const [oldMarkerGambar] = await conn.query(
      `SELECT ldm_spk_nomor AS spkNomor, ldm_gambar AS gambar
       FROM tlhkpola_marker_dtl WHERE ldm_nomor = ? AND ldm_gambar IS NOT NULL`,
      [nomor],
    );
    const markerGambarMap = new Map(
      oldMarkerGambar.map((r) => [r.spkNomor, r.gambar]),
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
    ]);
    await conn.query(
      `INSERT INTO tlhkpola_marker_dtl
         (ldm_nomor, ldm_urut, ldm_spk_nomor, ldm_lebar_kain, ldm_size,
          ldm_tujuan_proses, ldm_keterangan, ldm_gambar)
       VALUES ?`,
      [vals],
    );

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

module.exports = {
  getDetail,
  saveData,
  uploadGambarDetail,
  deleteData,
  searchSpk,
  getSpkByNomor,
  getDivisiNama,
};
