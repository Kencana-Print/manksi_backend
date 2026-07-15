const db = require("../../config/database");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

// ============================================================
// HELPER: sanitize nomor buat nama file (nomor LHK/SPK/MAP
// sering mengandung "/", gak boleh langsung jadi nama file)
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
     WHERE RIGHT(lhkp_nomor, 4) = ?`,
    [String(tahun)],
  );
  // FIX sekalian: bug pattern #1 — hasil agregat SQL harus di-Number() dulu
  const nextVal = Number(rows[0].jumlah) + 1;
  return `LHKP/${String(nextVal).padStart(4, "0")}/${tahun}`;
};

// ============================================================
// GET DETAIL — untuk mode Ubah
// ============================================================
const getDetail = async (nomor) => {
  const [headerRows] = await db.query(
    `SELECT * FROM tlhkpola_hdr WHERE lhkp_nomor = ?`,
    [nomor],
  );
  if (headerRows.length === 0)
    throw new Error("Data LHK Pola tidak ditemukan.");

  const [marker, grading] = await Promise.all([
    db.query(
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
    ),
    db.query(
      `SELECT d.ldg_id AS id, d.ldg_urut AS urut, d.ldg_spk_nomor AS spkNomor,
              IFNULL(s.spk_nama, m.mspk_nama) AS namaSpk,
              d.ldg_divisi AS divisi, d.ldg_grading_size AS gradingSize,
              d.ldg_keterangan AS keterangan, d.ldg_gambar AS gambar
       FROM tlhkpola_grading_dtl d
       LEFT JOIN tspk s ON s.spk_nomor = d.ldg_spk_nomor
       LEFT JOIN tmemospk m ON m.mspk_nomor = d.ldg_spk_nomor
       WHERE d.ldg_nomor = ?
       ORDER BY d.ldg_urut`,
      [nomor],
    ),
  ]);

  return {
    header: headerRows[0],
    marker: marker[0],
    grading: grading[0],
  };
};

// ============================================================
// SAVE DATA — create & edit
// ============================================================
const saveData = async (payload, user, isEdit) => {
  const {
    nomor: existingNomor,
    tanggal,
    keterangan,
    marker,
    grading,
  } = payload;

  if (!tanggal) throw new Error("Tanggal wajib diisi.");

  const markerFilled = (marker || []).filter(
    (r) => r.spkNomor && r.spkNomor.trim(),
  );
  const gradingFilled = (grading || []).filter(
    (r) => r.spkNomor && r.spkNomor.trim(),
  );
  if (markerFilled.length === 0 && gradingFilled.length === 0) {
    throw new Error(
      "Minimal harus ada 1 baris SPK terisi (di tab Marker/Mika/Duplek atau Pola/Grading).",
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
         SET lhkp_tanggal = ?, lhkp_keterangan = ?,
             user_modified = ?, date_modified = NOW()
         WHERE lhkp_nomor = ?`,
        [tanggal, keterangan || "", user.kode, nomor],
      );
    } else {
      nomor = await generateNomor(tanggal);
      await conn.query(
        `INSERT INTO tlhkpola_hdr
           (lhkp_nomor, lhkp_tanggal, lhkp_keterangan, user_create, date_create)
         VALUES (?, ?, ?, ?, NOW())`,
        [nomor, tanggal, keterangan || "", user.kode],
      );
    }

    // ── Tarik dulu mapping gambar lama (per spkNomor) SEBELUM di-delete,
    // supaya gambar "nempel" ke SPK meski urut baris berubah ──
    const [oldMarkerGambar] = await conn.query(
      `SELECT ldm_spk_nomor AS spkNomor, ldm_gambar AS gambar
       FROM tlhkpola_marker_dtl WHERE ldm_nomor = ? AND ldm_gambar IS NOT NULL`,
      [nomor],
    );
    const markerGambarMap = new Map(
      oldMarkerGambar.map((r) => [r.spkNomor, r.gambar]),
    );

    const [oldGradingGambar] = await conn.query(
      `SELECT ldg_spk_nomor AS spkNomor, ldg_gambar AS gambar
       FROM tlhkpola_grading_dtl WHERE ldg_nomor = ? AND ldg_gambar IS NOT NULL`,
      [nomor],
    );
    const gradingGambarMap = new Map(
      oldGradingGambar.map((r) => [r.spkNomor, r.gambar]),
    );

    // --- Replace total detail Marker/Mika/Duplek ---
    await conn.query(`DELETE FROM tlhkpola_marker_dtl WHERE ldm_nomor = ?`, [
      nomor,
    ]);
    if (markerFilled.length > 0) {
      const vals = markerFilled.map((r, i) => [
        nomor,
        i + 1,
        r.spkNomor,
        r.lebarKain || "",
        r.size || "",
        r.tujuanProses || "",
        r.keterangan || "",
        markerGambarMap.get(r.spkNomor) || null, // ← carry-forward
      ]);
      await conn.query(
        `INSERT INTO tlhkpola_marker_dtl
           (ldm_nomor, ldm_urut, ldm_spk_nomor, ldm_lebar_kain, ldm_size,
            ldm_tujuan_proses, ldm_keterangan, ldm_gambar)
         VALUES ?`,
        [vals],
      );
    }

    // --- Replace total detail Pola/Grading ---
    await conn.query(`DELETE FROM tlhkpola_grading_dtl WHERE ldg_nomor = ?`, [
      nomor,
    ]);
    if (gradingFilled.length > 0) {
      const vals = gradingFilled.map((r, i) => [
        nomor,
        i + 1,
        r.spkNomor,
        r.divisi || "",
        r.gradingSize || "",
        r.keterangan || "",
        gradingGambarMap.get(r.spkNomor) || null, // ← carry-forward
      ]);
      await conn.query(
        `INSERT INTO tlhkpola_grading_dtl
           (ldg_nomor, ldg_urut, ldg_spk_nomor, ldg_divisi, ldg_grading_size, ldg_keterangan, ldg_gambar)
         VALUES ?`,
        [vals],
      );
    }

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
// UPLOAD GAMBAR PER BARIS — dipanggil SETELAH save berhasil
// (nomor LHK sudah pasti ada). Key = spkNomor, bukan urut.
// ============================================================
const uploadGambarDetail = async (tempFilePath, lhkNomor, tab, spkNomor) => {
  if (!fs.existsSync(tempFilePath))
    throw new Error("File sumber sementara tidak ditemukan.");
  if (tab !== "marker" && tab !== "grading")
    throw new Error("Tab tidak valid.");

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

  // Update kolom gambar di baris yang match spkNomor
  const col = tab === "marker" ? "ldm_gambar" : "ldg_gambar";
  const table =
    tab === "marker" ? "tlhkpola_marker_dtl" : "tlhkpola_grading_dtl";
  const nomorCol = tab === "marker" ? "ldm_nomor" : "ldg_nomor";
  const spkCol = tab === "marker" ? "ldm_spk_nomor" : "ldg_spk_nomor";

  const [result] = await db.query(
    `UPDATE ${table} SET ${col} = ? WHERE ${nomorCol} = ? AND ${spkCol} = ?`,
    [finalFileName, lhkNomor, spkNomor],
  );
  if (result.affectedRows === 0) {
    throw new Error(
      `Baris SPK ${spkNomor} tidak ditemukan di ${tab} untuk LHK Pola ${lhkNomor}.`,
    );
  }

  return finalFileName;
};

// ============================================================
// DELETE
// ============================================================
const deleteData = async (nomor) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM tlhkpola_marker_dtl WHERE ldm_nomor = ?`, [
      nomor,
    ]);
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
// LOOKUP SPK/MAP
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
     LIMIT 50`,
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
