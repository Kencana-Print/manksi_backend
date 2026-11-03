const db = require("../../config/database");
const { hitungStatus } = require("./permintaanMarkerService");

const bad = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

const STATUS_MANUAL = ["PENDING", "CANCEL"];

// ─── Helpers ──────────────────────────────────────────────
const generateNomor = async (tanggal, conn) => {
  const d = new Date(tanggal);
  const yyyymm = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `PMK.${yyyymm}.`;
  const [[row]] = await (conn || db).query(
    `SELECT IFNULL(MAX(CAST(RIGHT(pm_nomor,4) AS UNSIGNED)),0) AS maxVal
     FROM tpermintaan_marker WHERE pm_nomor LIKE ?`,
    [`${prefix}%`],
  );
  const next = Number(row.maxVal) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
};

// Progres LHK: SPK selesai = SPK di detail yang punya baris LHK menunjuk permintaan ini.
const getProgress = async (conn, nomor) => {
  const [[r]] = await conn.query(
    `SELECT COUNT(DISTINCT d.pm2_spk_nomor) AS jmlSpk,
            COUNT(DISTINCT IF(l.ldm_id IS NULL, NULL, d.pm2_spk_nomor)) AS jmlSpkSelesai
       FROM tpermintaan_marker_detail d
       LEFT JOIN tlhkpola_marker_dtl l
         ON l.ldm_pm_nomor = d.pm2_pm_nomor AND l.ldm_spk_nomor = d.pm2_spk_nomor
      WHERE d.pm2_pm_nomor = ?`,
    [nomor],
  );
  const [[lhk]] = await conn.query(
    `SELECT COUNT(*) AS jmlLhk FROM tlhkpola_marker_dtl WHERE ldm_pm_nomor = ?`,
    [nomor],
  );
  return {
    jmlSpk: Number(r.jmlSpk),
    jmlSpkSelesai: Number(r.jmlSpkSelesai),
    jmlLhk: Number(lhk.jmlLhk),
  };
};

const lockHeader = async (conn, nomor) => {
  const [[hdr]] = await conn.query(
    `SELECT * FROM tpermintaan_marker WHERE pm_nomor = ? FOR UPDATE`,
    [nomor],
  );
  if (!hdr) throw bad("Permintaan Marker tidak ditemukan.", 404);
  return hdr;
};

// MKB sebuah SPK PPIC bisa tersimpan di bawah nomor SO asalnya (tspk.spk_so_ref)
const nomorMkbSpk = async (conn, spk) => {
  const [rows] = await conn.query(
    `SELECT spk_so_ref AS soRef FROM tspk WHERE spk_nomor = ?`,
    [spk],
  );
  const ref = rows[0]?.soRef;
  return ref ? [spk, ref] : [spk];
};

const cariPengganti = async (conn, nomor) => {
  const [[row]] = await conn.query(
    `SELECT pm_nomor FROM tpermintaan_marker WHERE pm_asal_nomor = ? LIMIT 1`,
    [nomor],
  );
  return row ? row.pm_nomor : null;
};

const dalamTransaksi = async (fn) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const hasil = await fn(conn);
    await conn.commit();
    return hasil;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// Status permintaan saat ini (dihitung); abaikanManual = lihat status "di bawah" PENDING/CANCEL
const statusSaatIni = async (
  conn,
  hdr,
  nomor,
  { abaikanManual = false } = {},
) => {
  const p = await getProgress(conn, nomor);
  return {
    ...p,
    status: hitungStatus({
      statusManual: abaikanManual ? "" : hdr.pm_status_manual,
      pic: hdr.pm_pic,
      dateClose: hdr.pm_date_close,
      jmlSpk: p.jmlSpk,
      jmlSpkSelesai: p.jmlSpkSelesai,
    }),
  };
};

const bahanDiMkb = async (conn, spk, kode) => {
  const nomor = await nomorMkbSpk(conn, spk);
  const [rows] = await conn.query(
    `SELECT 1
       FROM tmkb_hdr h
       INNER JOIN tmkb_dtl d ON d.mkbd_mkb_nomor = h.mkb_nomor
      WHERE h.mkb_spk_nomor IN (?) AND d.mkbd_bhn_kode = ?
      LIMIT 1`,
    [nomor, kode],
  );
  return rows.length > 0;
};

const spkPunyaMkb = async (conn, spk) => {
  const nomor = await nomorMkbSpk(conn, spk);
  const [rows] = await conn.query(
    `SELECT 1
       FROM tmkb_hdr h
       INNER JOIN tmkb_dtl d ON d.mkbd_mkb_nomor = h.mkb_nomor
      WHERE h.mkb_spk_nomor IN (?)
      LIMIT 1`,
    [nomor],
  );
  return rows.length > 0;
};

// ─── Validasi + normalisasi detail ────────────────────────
const normalisasiDetail = async (conn, detail) => {
  const rows = (Array.isArray(detail) ? detail : []).filter(
    (d) => d && (d.spkNomor || d.kode || Number(d.jml)),
  );
  if (!rows.length) throw bad("Minimal satu baris detail.");

  const seen = new Set();
  const hasil = [];

  for (let i = 0; i < rows.length; i++) {
    const d = rows[i];
    const no = i + 1;
    const spk = String(d.spkNomor || "").trim();
    const kode = String(d.kode || "").trim();
    const setting = String(d.setting || "").trim();
    const alasan = String(d.alasan || "").trim();
    const jml = Number(d.jml);

    if (!spk) throw bad(`Baris ${no}: SPK wajib diisi.`);
    if (!kode) throw bad(`Baris ${no}: kode bahan wajib diisi.`);
    if (!setting) throw bad(`Baris ${no}: setting wajib diisi.`);
    if (!Number.isInteger(jml) || jml <= 0) {
      throw bad(`Baris ${no}: jumlah marker harus bilangan bulat di atas 0.`);
    }

    const key = `${spk}|${kode}|${setting}`;
    if (seen.has(key)) {
      throw bad(
        `Baris ${no}: SPK, bahan, dan setting yang sama sudah ada di baris lain.`,
      );
    }
    seen.add(key);

    // Sama dengan lookup spk-map: SPK PPIC dan MAP, ber-CMO, divisi 3/4/6
    const [spkRows] = await conn.query(
      `SELECT 1 FROM tspk
        WHERE spk_nomor = ? AND spk_aktif = 'Y' AND spk_cmo <> ''
          AND spk_divisi IN (3,4,6)
       UNION ALL
       SELECT 1 FROM tmemospk
        WHERE mspk_nomor = ? AND mspk_cmo <> ''
          AND mspk_divisi IN (3,4,6)
       LIMIT 1`,
      [spk, spk],
    );
    if (!spkRows.length) {
      throw bad(
        `Baris ${no}: SPK ${spk} tidak ditemukan atau bukan divisi 3, 4, 6.`,
      );
    }

    const [bhnRows] = await conn.query(
      `SELECT 1 FROM tbahan WHERE Bhn_kode = ?`,
      [kode],
    );
    if (!bhnRows.length) throw bad(`Baris ${no}: bahan ${kode} tidak ada.`);

    const [setRows] = await conn.query(
      `SELECT 1 FROM tbahan_setting WHERE bs_nama = ?`,
      [setting],
    );
    if (!setRows.length) {
      throw bad(`Baris ${no}: setting "${setting}" tidak ada di master.`);
    }

    // Alasan wajib hanya bila SPK punya MKB tetapi bahan ini tidak ada di dalamnya.
    // SPK tanpa MKB: bahan bebas dipilih manual, tanpa alasan.
    const punyaMkb = await spkPunyaMkb(conn, spk);
    const luarMkb = punyaMkb && !(await bahanDiMkb(conn, spk, kode));
    if (luarMkb && !alasan) {
      throw bad(
        `Baris ${no}: bahan ${kode} tidak ada di MKB SPK ${spk}, alasan wajib diisi.`,
      );
    }

    hasil.push([
      spk,
      kode,
      setting,
      jml,
      luarMkb ? alasan.slice(0, 255) : null,
    ]);
  }
  return hasil;
};

// ─── Simpan (create / update) ─────────────────────────────
const saveData = async (payload, user) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const nomorLama = payload.nomor || "";
    const isEdit = !!nomorLama;
    const tanggal = String(payload.tanggal || "").slice(0, 10);
    const deadline = String(payload.deadline || "").slice(0, 10);
    const keterangan = String(payload.keterangan || "").trim() || null;
    const asalNomor = String(payload.asalNomor || "").trim();

    if (!tanggal) throw bad("Tanggal wajib diisi.");
    if (!deadline) throw bad("Deadline wajib diisi.");
    if (deadline < tanggal) {
      throw bad("Deadline tidak boleh lebih awal dari tanggal permintaan.");
    }

    const detailRows = await normalisasiDetail(conn, payload.detail);
    let nomor = nomorLama;

    if (isEdit) {
      const hdr = await lockHeader(conn, nomor);
      if (hdr.pm_status_manual === "CANCEL") {
        throw bad("Permintaan yang dibatalkan tidak dapat diubah.");
      }
      const { jmlLhk } = await getProgress(conn, nomor);
      if (jmlLhk > 0) {
        throw bad("Permintaan sudah punya LHK Marker, tidak dapat diubah.");
      }
      await conn.query(
        `UPDATE tpermintaan_marker
            SET pm_tanggal = ?, pm_deadline = ?, pm_keterangan = ?,
                pm_user_modified = ?, pm_date_modified = NOW()
          WHERE pm_nomor = ?`,
        [tanggal, deadline, keterangan, user.kode, nomor],
      );
      await conn.query(
        `DELETE FROM tpermintaan_marker_detail WHERE pm2_pm_nomor = ?`,
        [nomor],
      );
    } else {
      if (asalNomor) {
        const asal = await lockHeader(conn, asalNomor);
        if (asal.pm_status_manual === "CANCEL") {
          throw bad(`Permintaan asal ${asalNomor} sudah dibatalkan.`);
        }
        if (asal.pm_date_close) {
          throw bad(
            `Permintaan asal ${asalNomor} sudah CLOSE, tidak bisa direvisi.`,
          );
        }
        const sudah = await cariPengganti(conn, asalNomor);
        if (sudah) {
          throw bad(
            `Permintaan asal ${asalNomor} sudah direvisi oleh ${sudah}.`,
          );
        }
      }

      nomor = await generateNomor(tanggal, conn);
      await conn.query(
        `INSERT INTO tpermintaan_marker
           (pm_nomor, pm_tanggal, pm_deadline, pm_keterangan, pm_asal_nomor,
            pm_user_create, pm_date_create)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [nomor, tanggal, deadline, keterangan, asalNomor || null, user.kode],
      );

      // Revisi: permintaan lama otomatis CANCEL
      if (asalNomor) {
        await conn.query(
          `UPDATE tpermintaan_marker
              SET pm_status_manual = 'CANCEL',
                  pm_status_keterangan = ?,
                  pm_user_modified = ?, pm_date_modified = NOW()
            WHERE pm_nomor = ?`,
          [`Direvisi oleh ${nomor}`, user.kode, asalNomor],
        );
      }
    }

    await conn.query(
      `INSERT INTO tpermintaan_marker_detail
         (pm2_pm_nomor, pm2_spk_nomor, pm2_bhn_kode, pm2_setting, pm2_jml, pm2_alasan)
       VALUES ?`,
      [detailRows.map((r) => [nomor, ...r])],
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

// ─── Status manual: PENDING / CANCEL / buka kembali ───────
const setStatus = async (nomor, payload, user) => {
  const status = String(payload.status || "").trim();
  const keterangan = String(payload.keterangan || "").trim();

  if (status !== "" && !STATUS_MANUAL.includes(status)) {
    throw bad("Status tidak valid.");
  }
  if (status !== "" && !keterangan) {
    throw bad("Keterangan wajib diisi.");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const hdr = await lockHeader(conn, nomor);

    const pengganti = await cariPengganti(conn, nomor);
    if (pengganti) {
      throw bad(
        `Permintaan sudah direvisi oleh ${pengganti}, status tidak bisa diubah.`,
      );
    }

    if (status === "") {
      if (!hdr.pm_status_manual) {
        throw bad("Permintaan tidak sedang PENDING atau CANCEL.");
      }
    } else {
      const st = await statusSaatIni(conn, hdr, nomor, { abaikanManual: true });
      if (st.status === "DONE" || st.status === "CLOSE") {
        throw bad(
          `Permintaan sudah ${st.status}, tidak bisa di-PENDING atau di-CANCEL.`,
        );
      }
    }

    await conn.query(
      `UPDATE tpermintaan_marker
          SET pm_status_manual = ?, pm_status_keterangan = ?,
              pm_user_modified = ?, pm_date_modified = NOW()
        WHERE pm_nomor = ?`,
      [status, status === "" ? "" : keterangan.slice(0, 255), user.kode, nomor],
    );

    await conn.commit();
    return { nomor, status };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// ─── Detail (mode edit / lihat / dasar revisi) ────────────
const getDetail = async (nomor) => {
  const [[h]] = await db.query(
    `SELECT pm_nomor AS nomor,
            DATE_FORMAT(pm_tanggal, '%Y-%m-%d') AS tanggal,
            DATE_FORMAT(pm_deadline, '%Y-%m-%d') AS deadline,
            IFNULL(pm_keterangan, '') AS keterangan,
            pm_asal_nomor AS asalNomor,
            pm_status_manual AS statusManual,
            pm_status_keterangan AS statusKeterangan,
            pm_user_create AS userCreate,
            pm_pic AS pic,
            pm_pic_asal AS picAsal,
            DATE_FORMAT(pm_tgl_ambil, '%Y-%m-%d %H:%i') AS tglAmbil,
            pm_user_close AS userClose,
            DATE_FORMAT(pm_date_close, '%Y-%m-%d %H:%i') AS dateClose
       FROM tpermintaan_marker WHERE pm_nomor = ?`,
    [nomor],
  );
  if (!h) throw bad("Permintaan Marker tidak ditemukan.", 404);

  const [detail] = await db.query(
    `SELECT d.pm2_id AS id,
            d.pm2_spk_nomor AS spkNomor,
            IFNULL(so.so_nama, IFNULL(s.spk_nama, m.mspk_nama)) AS spkNama,
            d.pm2_bhn_kode AS kode,
            IFNULL(b.Bhn_Name, '') AS namaBahan,
            IFNULL(b.Bhn_satuan, '') AS satuan,
            d.pm2_setting AS setting,
            d.pm2_jml AS jml,
            IFNULL(d.pm2_alasan, '') AS alasan
       FROM tpermintaan_marker_detail d
       LEFT JOIN tsalesorder so ON so.so_nomor = d.pm2_spk_nomor
       LEFT JOIN tspk s ON s.spk_nomor = d.pm2_spk_nomor
       LEFT JOIN tmemospk m ON m.mspk_nomor = d.pm2_spk_nomor
       LEFT JOIN tbahan b ON b.Bhn_kode = d.pm2_bhn_kode
      WHERE d.pm2_pm_nomor = ?
      ORDER BY d.pm2_id`,
    [nomor],
  );

  const [lhk] = await db.query(
    `SELECT l.ldm_nomor AS lhkNomor,
            l.ldm_spk_nomor AS spkNomor,
            l.ldm_lebar_kain AS lebarKain,
            l.ldm_size AS size
       FROM tlhkpola_marker_dtl l
      WHERE l.ldm_pm_nomor = ?
      ORDER BY l.ldm_nomor, l.ldm_urut`,
    [nomor],
  );

  const { jmlSpk, jmlSpkSelesai, jmlLhk } = await getProgress(db, nomor);
  const penggantiNomor = await cariPengganti(db, nomor);

  return {
    ...h,
    penggantiNomor,
    jmlSpk,
    jmlSpkSelesai,
    status: hitungStatus({ ...h, jmlSpk, jmlSpkSelesai }),
    bisaUbah: jmlLhk === 0 && h.statusManual !== "CANCEL",
    detail,
    lhk,
  };
};

// ─── Lookup ───────────────────────────────────────────────
// Bahan yang ada di MKB sebuah SPK/MAP, setting default dari dua karakter terakhir kode
const getBahanMkb = async (spk) => {
  if (!spk) return [];
  const nomor = await nomorMkbSpk(db, spk);
  const [rows] = await db.query(
    `SELECT d.mkbd_bhn_kode AS kode,
            IFNULL(b.Bhn_Name, '') AS nama,
            IFNULL(b.Bhn_satuan, '') AS satuan,
            IFNULL(st.bs_nama, '') AS setting
       FROM tmkb_hdr h
       INNER JOIN tmkb_dtl d ON d.mkbd_mkb_nomor = h.mkb_nomor
       LEFT JOIN tbahan b ON b.Bhn_kode = d.mkbd_bhn_kode
       LEFT JOIN tbahan_setting st ON st.bs_kode = RIGHT(TRIM(d.mkbd_bhn_kode), 2)
      WHERE h.mkb_spk_nomor IN (?) AND d.mkbd_bhn_kode <> ''
      GROUP BY d.mkbd_bhn_kode, b.Bhn_Name, b.Bhn_satuan, st.bs_nama
      ORDER BY MIN(d.mkbd_nourut)`,
    [nomor],
  );
  return rows;
};

// Info satu bahan (untuk bahan dari luar MKB): default setting + apakah ada di MKB SPK
const getBahanInfo = async (kode, spk) => {
  const [[b]] = await db.query(
    `SELECT b.Bhn_kode AS kode,
            IFNULL(b.Bhn_Name, '') AS nama,
            IFNULL(b.Bhn_satuan, '') AS satuan,
            IFNULL(st.bs_nama, '') AS setting
       FROM tbahan b
       LEFT JOIN tbahan_setting st ON st.bs_kode = RIGHT(TRIM(b.Bhn_kode), 2)
      WHERE b.Bhn_kode = ?`,
    [kode],
  );
  if (!b) throw bad("Bahan tidak ditemukan.", 404);
  const diMkb = spk ? await bahanDiMkb(db, spk, kode) : false;
  return { ...b, diMkb };
};

const getSettings = async () => {
  const [rows] = await db.query(
    `SELECT bs_kode AS kode, bs_nama AS nama FROM tbahan_setting ORDER BY bs_nama`,
  );
  return rows;
};

// ─── Ambil / ambil alih / lepas / close ───────────────────
const kodeUser = (user) => String(user?.kode || "").trim();

// Ambil permintaan yang belum dipegang siapa pun
const ambil = async (nomor, user) =>
  dalamTransaksi(async (conn) => {
    const kode = kodeUser(user);
    const hdr = await lockHeader(conn, nomor);
    const st = await statusSaatIni(conn, hdr, nomor);
    if (st.status !== "OPEN" && st.status !== "PROSES") {
      throw bad(`Permintaan berstatus ${st.status}, tidak bisa diambil.`);
    }
    if (hdr.pm_pic) {
      throw bad(`Permintaan sudah dipegang ${hdr.pm_pic}.`);
    }
    await conn.query(
      `UPDATE tpermintaan_marker
          SET pm_pic = ?, pm_pic_asal = NULL, pm_tgl_ambil = NOW(),
              pm_user_modified = ?, pm_date_modified = NOW()
        WHERE pm_nomor = ?`,
      [kode, kode, nomor],
    );
    return { nomor, pic: kode };
  });

// Ambil alih permintaan yang masih dipegang PIC lain
const ambilAlih = async (nomor, user) =>
  dalamTransaksi(async (conn) => {
    const kode = kodeUser(user);
    const hdr = await lockHeader(conn, nomor);
    const st = await statusSaatIni(conn, hdr, nomor);
    if (st.status !== "PROSES") {
      throw bad(`Permintaan berstatus ${st.status}, tidak bisa diambil alih.`);
    }
    if (!hdr.pm_pic) {
      throw bad("Permintaan belum dipegang siapa pun, ambil saja.");
    }
    if (hdr.pm_pic === kode) {
      throw bad("Permintaan ini sudah dipegang kamu.");
    }
    await conn.query(
      `UPDATE tpermintaan_marker
          SET pm_pic_asal = pm_pic, pm_pic = ?, pm_tgl_ambil = NOW(),
              pm_user_modified = ?, pm_date_modified = NOW()
        WHERE pm_nomor = ?`,
      [kode, kode, nomor],
    );
    return { nomor, dari: hdr.pm_pic, ke: kode };
  });

// Lepas permintaan milik sendiri (salah ambil)
const lepas = async (nomor, user) =>
  dalamTransaksi(async (conn) => {
    const kode = kodeUser(user);
    const hdr = await lockHeader(conn, nomor);
    if (hdr.pm_pic !== kode) {
      throw bad("Permintaan ini tidak dipegang kamu.");
    }
    const st = await statusSaatIni(conn, hdr, nomor);
    if (st.status !== "PROSES") {
      throw bad(`Permintaan berstatus ${st.status}, tidak bisa dilepas.`);
    }
    await conn.query(
      `UPDATE tpermintaan_marker
          SET pm_pic = NULL, pm_pic_asal = NULL, pm_tgl_ambil = NULL,
              pm_user_modified = ?, pm_date_modified = NOW()
        WHERE pm_nomor = ?`,
      [kode, nomor],
    );
    return { nomor };
  });

// Close oleh Admin Cutting: hasil marker sudah diambil; hanya untuk permintaan DONE
const closePermintaan = async (nomor, user) =>
  dalamTransaksi(async (conn) => {
    const kode = kodeUser(user);
    const hdr = await lockHeader(conn, nomor);
    const st = await statusSaatIni(conn, hdr, nomor);
    if (st.status !== "DONE") {
      throw bad(
        `Hanya permintaan berstatus DONE yang bisa di-CLOSE (sekarang ${st.status}).`,
      );
    }
    await conn.query(
      `UPDATE tpermintaan_marker
          SET pm_user_close = ?, pm_date_close = NOW(),
              pm_user_modified = ?, pm_date_modified = NOW()
        WHERE pm_nomor = ?`,
      [kode, kode, nomor],
    );
    return { nomor, status: "CLOSE" };
  });

module.exports = {
  getDetail,
  saveData,
  setStatus,
  getBahanMkb,
  getBahanInfo,
  getSettings,
  ambil,
  ambilAlih,
  lepas,
  closePermintaan,
};
