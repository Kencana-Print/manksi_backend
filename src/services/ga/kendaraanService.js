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
      IFNULL(tahun, '') AS Tahun,
      IFNULL(kondisi, '') AS Kondisi,
      IFNULL(kepemilikan, '') AS Kepemilikan,
      IFNULL(posisi, '') AS Posisi,
      IFNULL(usr, '') AS Usr,
      IFNULL(jadwal, 0) AS Jadwal_Servis,
      IFNULL(kmterakhir, 0) AS KmTerakhir,
      DATE_FORMAT(pajak, '%Y-%m-%d') AS Pajak,
      DATE_FORMAT(kir, '%Y-%m-%d') AS Kir,
      IFNULL(aktif, 'Y') AS Aktif
    FROM ga2.kendaraan
  `;
  const params = [];

  if (search && search.trim()) {
    query += ` WHERE nopol LIKE ? OR Keterangan LIKE ? OR stat LIKE ? OR tahun LIKE ? OR kondisi LIKE ? OR kepemilikan LIKE ? OR posisi LIKE ? OR usr LIKE ? OR aktif LIKE ?`;
    const term = `%${search.trim()}%`;
    params.push(term, term, term, term, term, term, term, term, term);
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
      IFNULL(tahun, '') AS Tahun,
      IFNULL(kondisi, '') AS Kondisi,
      IFNULL(kepemilikan, '') AS Kepemilikan,
      IFNULL(posisi, '') AS Posisi,
      IFNULL(usr, '') AS Usr,
      IFNULL(jadwal, 0) AS Jadwal_Servis,
      IFNULL(kmterakhir, 0) AS KmTerakhir,
      DATE_FORMAT(pajak, '%Y-%m-%d') AS Pajak,
      DATE_FORMAT(kir, '%Y-%m-%d') AS Kir,
      IFNULL(aktif, 'Y') AS Aktif
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
    tahun = "",
    kondisi = "",
    kepemilikan = "",
    posisi = "",
    usr = "",
    jadwal = 0,
    kmterakhir = 0,
    pajak = null,
    kir = null,
    aktif = "Y",
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
  const tglKir = kir ? kir : null;
  const tahunClean = String(tahun || "").replace(/[^\d]/g, "").slice(0, 4);
  const kondisiUpper = (kondisi || "").trim().toUpperCase().slice(0, 20);
  const kepemilikanUpper = (kepemilikan || "").trim().toUpperCase().slice(0, 50);
  const posisiUpper = (posisi || "").trim().toUpperCase().slice(0, 20);
  const usrUpper = (usr || "").trim().toUpperCase().slice(0, 30);
  const aktifVal = String(aktif || "Y").trim().toUpperCase() === "N" ? "N" : "Y";

  await pool.query(
    `INSERT INTO ga2.kendaraan (nopol, stat, Keterangan, tahun, kondisi, kepemilikan, posisi, usr, jadwal, kmterakhir, pajak, kir, aktif)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nopolTrimmed,
      stat,
      keterangan.trim().toUpperCase(),
      tahunClean,
      kondisiUpper,
      kepemilikanUpper,
      posisiUpper,
      usrUpper,
      Number(jadwal) || 0,
      Number(kmterakhir) || 0,
      tglPajak,
      tglKir,
      aktifVal,
    ],
  );

  // Sync ke bsmcabang.kendaraan jika tabel tersedia
  try {
    await pool.query(
      `INSERT INTO bsmcabang.kendaraan (nopol, stat, Keterangan, tahun, kondisi, kepemilikan, posisi, usr, jadwal, kmterakhir, pajak, kir, aktif)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
         stat = VALUES(stat),
         Keterangan = VALUES(Keterangan),
         tahun = VALUES(tahun),
         kondisi = VALUES(kondisi),
         kepemilikan = VALUES(kepemilikan),
         posisi = VALUES(posisi),
         usr = VALUES(usr),
         jadwal = VALUES(jadwal),
         kmterakhir = VALUES(kmterakhir),
         pajak = VALUES(pajak),
         kir = VALUES(kir),
         aktif = VALUES(aktif)`,
      [
        nopolTrimmed,
        stat,
        keterangan.trim().toUpperCase(),
        tahunClean,
        kondisiUpper,
        kepemilikanUpper,
        posisiUpper,
        usrUpper,
        Number(jadwal) || 0,
        Number(kmterakhir) || 0,
        tglPajak,
        tglKir,
        aktifVal,
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
    tahun = "",
    kondisi = "",
    kepemilikan = "",
    posisi = "",
    usr = "",
    jadwal = 0,
    kmterakhir = 0,
    pajak = null,
    kir = null,
    aktif = "Y",
  } = payload;

  const nopolTrimmed = (nopol || "").trim().toUpperCase();
  if (!nopolTrimmed) {
    throw new Error("Nomor Polisi harus disertakan.");
  }

  const tglPajak = pajak ? pajak : null;
  const tglKir = kir ? kir : null;
  const tahunClean = String(tahun || "").replace(/[^\d]/g, "").slice(0, 4);
  const kondisiUpper = (kondisi || "").trim().toUpperCase().slice(0, 20);
  const kepemilikanUpper = (kepemilikan || "").trim().toUpperCase().slice(0, 50);
  const posisiUpper = (posisi || "").trim().toUpperCase().slice(0, 20);
  const usrUpper = (usr || "").trim().toUpperCase().slice(0, 30);
  const aktifVal = String(aktif || "Y").trim().toUpperCase() === "N" ? "N" : "Y";

  const [res] = await pool.query(
    `UPDATE ga2.kendaraan SET 
       stat = ?,
       Keterangan = ?,
       tahun = ?,
       kondisi = ?,
       kepemilikan = ?,
       posisi = ?,
       usr = ?,
       jadwal = ?,
       kmterakhir = ?,
       pajak = ?,
       kir = ?,
       aktif = ?
     WHERE nopol = ?`,
    [
      stat,
      keterangan.trim().toUpperCase(),
      tahunClean,
      kondisiUpper,
      kepemilikanUpper,
      posisiUpper,
      usrUpper,
      Number(jadwal) || 0,
      Number(kmterakhir) || 0,
      tglPajak,
      tglKir,
      aktifVal,
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
         tahun = ?,
         kondisi = ?,
         kepemilikan = ?,
         posisi = ?,
         usr = ?,
         jadwal = ?,
         kmterakhir = ?,
         pajak = ?,
         kir = ?,
         aktif = ?
       WHERE nopol = ?`,
      [
        stat,
        keterangan.trim().toUpperCase(),
        tahunClean,
        kondisiUpper,
        kepemilikanUpper,
        posisiUpper,
        usrUpper,
        Number(jadwal) || 0,
        Number(kmterakhir) || 0,
        tglPajak,
        tglKir,
        aktifVal,
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
