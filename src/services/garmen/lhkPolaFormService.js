const db = require("../../config/database");

// ============================================================
// LHK POLA — FORM SERVICE (create/edit + lookup SPK)
// ============================================================

// --- GENERATE NOMOR (format: LHKP/0001/2026) ---
const generateNomor = async (tanggal) => {
  const tahun = new Date(tanggal).getFullYear();
  const [rows] = await db.query(
    `SELECT IFNULL(MAX(CAST(SUBSTR(lhkp_nomor, 6, 4) AS UNSIGNED)), 0) AS jumlah
     FROM tlhkpola_hdr
     WHERE RIGHT(lhkp_nomor, 4) = ?`,
    [String(tahun)],
  );
  const nextVal = rows[0].jumlah + 1;
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
              d.ldm_tujuan_proses AS tujuanProses, d.ldm_mesin AS mesin,
              d.ldm_keterangan AS keterangan
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
              d.ldg_keterangan AS keterangan
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
// Wajib minimal 1 baris SPK terisi (di tab Marker ATAU Grading).
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
        r.mesin || "",
        r.keterangan || "",
      ]);
      await conn.query(
        `INSERT INTO tlhkpola_marker_dtl
           (ldm_nomor, ldm_urut, ldm_spk_nomor, ldm_lebar_kain, ldm_size,
            ldm_tujuan_proses, ldm_mesin, ldm_keterangan)
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
      ]);
      await conn.query(
        `INSERT INTO tlhkpola_grading_dtl
           (ldg_nomor, ldg_urut, ldg_spk_nomor, ldg_divisi, ldg_grading_size, ldg_keterangan)
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
// LOOKUP SPK/MAP — untuk F1/search di form (Marker & Grading tab)
// Sumber gabungan tmemospk (MAP) + tspk (SPK), divisi 3/4/6,
// sesuai filter Delphi frmLhkDesign F1 handler.
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

// Ambil satu SPK by nomor persis — dipakai saat user ketik manual +
// Enter (bukan lewat modal), untuk auto-fill Nama & Divisi.
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

// Nama divisi (label), bukan cuma kode angka
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
  deleteData,
  searchSpk,
  getSpkByNomor,
  getDivisiNama,
};
