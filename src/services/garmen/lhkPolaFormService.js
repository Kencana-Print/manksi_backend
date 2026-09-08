const db = require("../../config/database");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

// ============================================================
// HELPER: sanitize nomor buat nama file
// ============================================================
const sanitizeForFilename = (str) =>
  String(str || "").replace(/[\/\\:*?"<>|]/g, "_");

const buildGambarFileName = (lhkNomor, tab, spkNomor) =>
  `${sanitizeForFilename(lhkNomor)}-${tab}-${sanitizeForFilename(spkNomor)}.jpg`;

// --- GENERATE NOMOR (format: LHKP/0001/2026) ---
const generateNomor = async (tanggal) => {
  const tahun = new Date(tanggal).getFullYear();
  const [rows] = await db.query(
    `SELECT IFNULL(MAX(CAST(SUBSTR(lhkp_nomor, 6, 4) AS UNSIGNED)), 0) AS jumlah
     FROM tlhkpola_hdr
     WHERE lhkp_nomor LIKE 'LHKP/%' AND RIGHT(lhkp_nomor, 4) = ?`,
    [String(tahun)],
  );
  const nextVal = Number(rows[0].jumlah) + 1;
  return `LHKP/${String(nextVal).padStart(4, "0")}/${tahun}`;
};

// ============================================================
// GET DETAIL — untuk mode Ubah
// Hanya sisi Grading/Pola — Marker sudah dipindah ke menu terpisah
// (services/ppic/lhkMarkerFormService.js), sehingga tidak lagi
// dimuat/diedit lewat form ini meski datanya masih ada di DB
// (untuk record lama hasil form gabungan sebelum pemisahan).
// ============================================================
const getDetail = async (nomor) => {
  const [headerRows] = await db.query(
    `SELECT * FROM tlhkpola_hdr WHERE lhkp_nomor = ?`,
    [nomor],
  );
  if (headerRows.length === 0)
    throw new Error("Data LHK Pola tidak ditemukan.");

  const [grading] = await db.query(
    `SELECT d.ldg_id AS id, d.ldg_urut AS urut, d.ldg_spk_nomor AS spkNomor,
            IFNULL(s.spk_nama, m.mspk_nama) AS namaSpk,
            d.ldg_divisi AS divisi, d.ldg_grading_size AS gradingSize,
            d.ldg_panjang AS panjang, d.ldg_lebar AS lebar,
            d.ldg_keterangan AS keterangan, d.ldg_gambar AS gambar
    FROM tlhkpola_grading_dtl d
    LEFT JOIN tspk s ON s.spk_nomor = d.ldg_spk_nomor
    LEFT JOIN tmemospk m ON m.mspk_nomor = d.ldg_spk_nomor
    WHERE d.ldg_nomor = ?
    ORDER BY d.ldg_urut`,
    [nomor],
  );

  return {
    header: {
      ...headerRows[0],
      pembuatPola: headerRows[0].lhkp_pembuat_pola || "",
    },
    grading,
  };
};

// ============================================================
// SAVE DATA — create & edit (Grading/Pola saja)
// ============================================================
const saveData = async (payload, user, isEdit) => {
  const {
    nomor: existingNomor,
    tanggal,
    keterangan,
    pembuatPola,
    grading,
  } = payload;

  if (!tanggal) throw new Error("Tanggal wajib diisi.");

  const gradingFilled = (grading || []).filter(
    (r) => r.spkNomor && r.spkNomor.trim(),
  );
  if (gradingFilled.length === 0) {
    throw new Error("Minimal harus ada 1 baris SPK terisi di Pola/Grading.");
  }

  // Panjang & Lebar wajib diisi untuk setiap baris yang sudah ada SPK-nya
  const invalidRow = gradingFilled.find(
    (r) =>
      r.panjang === "" ||
      r.panjang === null ||
      r.panjang === undefined ||
      r.lebar === "" ||
      r.lebar === null ||
      r.lebar === undefined,
  );
  if (invalidRow) {
    throw new Error(
      `Panjang dan Lebar wajib diisi untuk SPK ${invalidRow.spkNomor}.`,
    );
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let nomor;
    if (isEdit) {
      if (!existingNomor) throw new Error("Nomor LHK Pola wajib diisi.");
      const [exist] = await conn.query(
        `SELECT lhkp_nomor FROM tlhkpola_hdr WHERE lhkp_nomor = ?`,
        [existingNomor],
      );
      if (exist.length === 0) throw new Error("Data LHK Pola tidak ditemukan.");
      nomor = existingNomor;
      await conn.query(
        `UPDATE tlhkpola_hdr
         SET lhkp_tanggal = ?, lhkp_keterangan = ?, lhkp_pembuat_pola = ?,
             user_modified = ?, date_modified = NOW()
         WHERE lhkp_nomor = ?`,
        [tanggal, keterangan || "", pembuatPola || "", user.kode, nomor],
      );
    } else {
      nomor = await generateNomor(tanggal);
      await conn.query(
        `INSERT INTO tlhkpola_hdr
           (lhkp_nomor, lhkp_tanggal, lhkp_keterangan, lhkp_pembuat_pola, user_create, date_create)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [nomor, tanggal, keterangan || "", pembuatPola || "", user.kode],
      );
    }

    // Tarik mapping gambar lama (per spkNomor) SEBELUM di-delete, supaya
    // gambar "nempel" ke SPK meski urut baris berubah.
    const [oldGradingGambar] = await conn.query(
      `SELECT ldg_spk_nomor AS spkNomor, ldg_gambar AS gambar
       FROM tlhkpola_grading_dtl WHERE ldg_nomor = ? AND ldg_gambar IS NOT NULL`,
      [nomor],
    );
    const gradingGambarMap = new Map(
      oldGradingGambar.map((r) => [r.spkNomor, r.gambar]),
    );

    // --- Replace total detail Pola/Grading ---
    await conn.query(`DELETE FROM tlhkpola_grading_dtl WHERE ldg_nomor = ?`, [
      nomor,
    ]);
    const vals = gradingFilled.map((r, i) => [
      nomor,
      i + 1,
      r.spkNomor,
      r.divisi || "",
      r.gradingSize || "",
      r.panjang,
      r.lebar,
      r.keterangan || "",
      gradingGambarMap.get(r.spkNomor) || null,
    ]);
    await conn.query(
      `INSERT INTO tlhkpola_grading_dtl
        (ldg_nomor, ldg_urut, ldg_spk_nomor, ldg_divisi, ldg_grading_size,
          ldg_panjang, ldg_lebar, ldg_keterangan, ldg_gambar)
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
// UPLOAD GAMBAR PER BARIS (khusus tab grading)
// ============================================================
const uploadGambarDetail = async (tempFilePath, lhkNomor, tab, spkNomor) => {
  if (!fs.existsSync(tempFilePath))
    throw new Error("File sumber sementara tidak ditemukan.");
  if (tab !== "grading") throw new Error("Tab tidak valid.");

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
    `UPDATE tlhkpola_grading_dtl SET ldg_gambar = ?
     WHERE ldg_nomor = ? AND ldg_spk_nomor = ?`,
    [finalFileName, lhkNomor, spkNomor],
  );
  if (result.affectedRows === 0) {
    throw new Error(
      `Baris SPK ${spkNomor} tidak ditemukan di grading untuk LHK Pola ${lhkNomor}.`,
    );
  }

  return finalFileName;
};

// ============================================================
// DELETE — hanya hapus grading + header. Marker (kalau ada, dari
// record lama gabungan) SENGAJA TIDAK disentuh — jadi data marker
// lama tidak hilang meski header LHK Pola-nya dihapus dari sisi ini.
// ============================================================
const deleteData = async (nomor) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM tlhkpola_grading_dtl WHERE ldg_nomor = ?`, [
      nomor,
    ]);
    const [result] = await conn.query(
      `DELETE FROM tlhkpola_hdr WHERE lhkp_nomor = ?`,
      [nomor],
    );
    if (result.affectedRows === 0)
      throw new Error("Data LHK Pola tidak ditemukan.");
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// ============================================================
// LOOKUP SPK/MAP — dipakai bareng oleh LHK Pola & LHK Marker
// ============================================================
const searchSpk = async (q = "") => {
  const like = `%${q}%`;
  const [rows] = await db.query(
    `SELECT x.* FROM (
       SELECT mspk_nomor AS Nomor, mspk_nama AS Nama, mspk_tanggal AS Tanggal,
              mspk_divisi AS Divisi
       FROM tmemospk
       WHERE mspk_cmo <> '' AND mspk_divisi IN (3,4,6)
       UNION ALL
       SELECT spk_nomor AS Nomor, spk_nama AS Nama, spk_tanggal AS Tanggal,
              spk_divisi AS Divisi
       FROM tspk
       WHERE spk_aktif = 'Y' AND spk_cmo <> '' AND spk_divisi IN (3,4,6)
     ) x
     WHERE x.Nomor LIKE ? OR x.Nama LIKE ?
     ORDER BY x.Tanggal DESC
     `,
    [like, like],
  );
  return rows;
};

const getSpkByNomor = async (nomor) => {
  const [rows] = await db.query(
    `SELECT x.* FROM (
       SELECT mspk_nomor AS Nomor, mspk_nama AS Nama, mspk_divisi AS Divisi
       FROM tmemospk
       WHERE mspk_cmo <> '' AND mspk_divisi IN (3,4,6) AND mspk_nomor = ?
       UNION ALL
       SELECT spk_nomor AS Nomor, spk_nama AS Nama, spk_divisi AS Divisi
       FROM tspk
       WHERE spk_aktif = 'Y' AND spk_cmo <> '' AND spk_divisi IN (3,4,6) AND spk_nomor = ?
     ) x LIMIT 1`,
    [nomor, nomor],
  );
  return rows[0] || null;
};

const getDivisiNama = async (kodeDivisi) => {
  if (!kodeDivisi) return "";
  const [rows] = await db.query(
    `SELECT divisi AS nama FROM tdivisi WHERE kode = ? LIMIT 1`,
    [kodeDivisi],
  );
  return rows[0]?.nama || String(kodeDivisi);
};

module.exports = {
  getDetail,
  saveData,
  uploadGambarDetail,
  deleteData,
  searchSpk,
  getSpkByNomor,
  getDivisiNama,
  buildGambarFileName,
};
