const pool = require("../../config/database");

/**
 * Service Master Kendaraan GA (ga2.kendaraan & bsmcabang.kendaraan)
 * Rujukan dari Delphi 7:
 * - ufrmBrowseKendaraan.pas
 * - ufrmKendaraan.pas
 */

const getAll = async (search = "") => {
  let query = `
    SELECT 
      nopol AS Nopol,
      IFNULL(stat, 'INVENTARIS') AS Stat,
      IFNULL(Keterangan, '') AS Keterangan,
      IFNULL(jadwal, 0) AS Jadwal_Servis,
      IFNULL(kmterakhir, 0) AS KmTerakhir,
      DATE_FORMAT(pajak, '%Y-%m-%d') AS Pajak
    FROM ga2.kendaraan
  `;
  const params = [];

  if (search && search.trim()) {
    query += ` WHERE nopol LIKE ? OR Keterangan LIKE ? OR stat LIKE ?`;
    const term = `%${search.trim()}%`;
    params.push(term, term, term);
  }

  query += ` ORDER BY nopol ASC`;

  const [rows] = await pool.query(query, params);
  return rows;
};

const getById = async (nopol) => {
  const query = `
    SELECT 
      nopol AS Nopol,
      IFNULL(stat, 'INVENTARIS') AS Stat,
      IFNULL(Keterangan, '') AS Keterangan,
      IFNULL(jadwal, 0) AS Jadwal_Servis,
      IFNULL(kmterakhir, 0) AS KmTerakhir,
      DATE_FORMAT(pajak, '%Y-%m-%d') AS Pajak
    FROM ga2.kendaraan
    WHERE nopol = ?
  `;
  const [rows] = await pool.query(query, [nopol]);
  if (!rows.length) {
    throw new Error(`Data kendaraan dengan nomor polisi ${nopol} tidak ditemukan.`);
  }
  return rows[0];
};

const create = async (payload) => {
  const {
    nopol,
    stat = "INVENTARIS",
    keterangan = "",
    jadwal = 0,
    kmterakhir = 0,
    pajak = null,
  } = payload;

  const nopolTrimmed = (nopol || "").trim().toUpperCase();
  if (!nopolTrimmed) {
    throw new Error("Nomor Polisi (Kode) harus diisi.");
  }

  // Cek duplikasi
  const [existing] = await pool.query(
    `SELECT nopol FROM ga2.kendaraan WHERE nopol = ?`,
    [nopolTrimmed],
  );
  if (existing.length > 0) {
    throw new Error(`Kendaraan dengan Nomor Polisi ${nopolTrimmed} sudah terdaftar.`);
  }

  const tglPajak = pajak ? pajak : null;

  await pool.query(
    `INSERT INTO ga2.kendaraan (nopol, stat, Keterangan, jadwal, kmterakhir, pajak)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      nopolTrimmed,
      stat,
      keterangan.trim().toUpperCase(),
      Number(jadwal) || 0,
      Number(kmterakhir) || 0,
      tglPajak,
    ],
  );

  // Sync ke bsmcabang.kendaraan jika tabel tersedia
  try {
    await pool.query(
      `INSERT INTO bsmcabang.kendaraan (nopol, stat, Keterangan, jadwal, kmterakhir, pajak)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
         stat = VALUES(stat),
         Keterangan = VALUES(Keterangan),
         jadwal = VALUES(jadwal),
         kmterakhir = VALUES(kmterakhir),
         pajak = VALUES(pajak)`,
      [
        nopolTrimmed,
        stat,
        keterangan.trim().toUpperCase(),
        Number(jadwal) || 0,
        Number(kmterakhir) || 0,
        tglPajak,
      ],
    );
  } catch (err) {
    // Sinkronisasi opsional, jangan gagalkan insert utama
    console.warn("Sync ke bsmcabang.kendaraan warning:", err.message);
  }

  return { nopol: nopolTrimmed };
};

const update = async (nopol, payload) => {
  const {
    stat = "INVENTARIS",
    keterangan = "",
    jadwal = 0,
    kmterakhir = 0,
    pajak = null,
  } = payload;

  const nopolTrimmed = (nopol || "").trim().toUpperCase();
  if (!nopolTrimmed) {
    throw new Error("Nomor Polisi harus disertakan.");
  }

  const tglPajak = pajak ? pajak : null;

  const [res] = await pool.query(
    `UPDATE ga2.kendaraan SET 
       stat = ?,
       Keterangan = ?,
       jadwal = ?,
       kmterakhir = ?,
       pajak = ?
     WHERE nopol = ?`,
    [
      stat,
      keterangan.trim().toUpperCase(),
      Number(jadwal) || 0,
      Number(kmterakhir) || 0,
      tglPajak,
      nopolTrimmed,
    ],
  );

  if (res.affectedRows === 0) {
    throw new Error(`Data kendaraan ${nopolTrimmed} tidak ditemukan.`);
  }

  // Sync ke bsmcabang.kendaraan
  try {
    await pool.query(
      `UPDATE bsmcabang.kendaraan SET 
         stat = ?,
         Keterangan = ?,
         jadwal = ?,
         kmterakhir = ?,
         pajak = ?
       WHERE nopol = ?`,
      [
        stat,
        keterangan.trim().toUpperCase(),
        Number(jadwal) || 0,
        Number(kmterakhir) || 0,
        tglPajak,
        nopolTrimmed,
      ],
    );
  } catch (err) {
    console.warn("Sync update ke bsmcabang.kendaraan warning:", err.message);
  }

  return { nopol: nopolTrimmed };
};

const deleteData = async (nopol) => {
  const nopolTrimmed = (nopol || "").trim().toUpperCase();
  if (!nopolTrimmed) {
    throw new Error("Nomor Polisi harus disertakan.");
  }

  const [res] = await pool.query(
    `DELETE FROM ga2.kendaraan WHERE nopol = ?`,
    [nopolTrimmed],
  );

  if (res.affectedRows === 0) {
    throw new Error(`Data kendaraan ${nopolTrimmed} tidak ditemukan.`);
  }

  try {
    await pool.query(`DELETE FROM bsmcabang.kendaraan WHERE nopol = ?`, [
      nopolTrimmed,
    ]);
  } catch (err) {
    console.warn("Sync delete ke bsmcabang.kendaraan warning:", err.message);
  }

  return { success: true };
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  deleteData,
};
