const pool = require("../../config/database");

/**
 * Service Master Pengguna GA (ga2.pengguna & bsmcabang.pengguna)
 * Rujukan dari Delphi 7:
 * - ufrmBrowsePengguna.pas
 * - ufrmPengguna.pas
 */

const getMaxKode = async (conn = null) => {
  const db = conn || pool;
  const [rows] = await db.query(
    `SELECT IFNULL(MAX(CAST(kode AS UNSIGNED)), 0) AS max_kode FROM ga2.pengguna`,
  );
  const nextNum = Number(rows[0]?.max_kode || 0) + 1;
  return String(nextNum).padStart(3, "0");
};

const getAll = async (search = "") => {
  let query = `
    SELECT 
      kode AS Kode,
      IFNULL(nama, '') AS Nama,
      IFNULL(aktif, 0) AS Aktif
    FROM ga2.pengguna
  `;
  const params = [];

  if (search && search.trim()) {
    query += ` WHERE kode LIKE ? OR nama LIKE ?`;
    const term = `%${search.trim()}%`;
    params.push(term, term);
  }

  query += ` ORDER BY CAST(kode AS UNSIGNED) ASC, kode ASC`;

  const [rows] = await pool.query(query, params);
  return rows;
};

const getById = async (kode) => {
  const query = `
    SELECT 
      kode AS Kode,
      IFNULL(nama, '') AS Nama,
      IFNULL(aktif, 0) AS Aktif
    FROM ga2.pengguna
    WHERE kode = ?
  `;
  const [rows] = await pool.query(query, [kode]);
  if (!rows.length) {
    throw new Error(`Data pengguna dengan kode ${kode} tidak ditemukan.`);
  }
  return rows[0];
};

const create = async (payload) => {
  const { kode, nama } = payload;

  const namaTrimmed = (nama || "").trim();
  if (!namaTrimmed) {
    throw new Error("Nama pengguna harus diisi.");
  }

  // Selalu generate kode berikutnya saat simpan jika data baru
  let kodeVal = (kode || "").trim();
  if (!kodeVal) {
    kodeVal = await getMaxKode();
  }

  // Cek duplikasi kode
  const [existing] = await pool.query(
    `SELECT kode FROM ga2.pengguna WHERE kode = ?`,
    [kodeVal],
  );
  if (existing.length > 0) {
    // Jika ternyata nomor bentrok, coba ambil max kode terbaru lagi
    kodeVal = await getMaxKode();
  }

  await pool.query(
    `INSERT INTO ga2.pengguna (kode, nama, aktif) VALUES (?, ?, 0)`,
    [kodeVal, namaTrimmed],
  );

  // Sync ke bsmcabang.pengguna jika tersedia
  try {
    await pool.query(
      `INSERT INTO bsmcabang.pengguna (kode, nama) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE nama = VALUES(nama)`,
      [kodeVal, namaTrimmed],
    );
  } catch (err) {
    console.warn("Sync ke bsmcabang.pengguna warning:", err.message);
  }

  return { kode: kodeVal, nama: namaTrimmed };
};

const update = async (kode, payload) => {
  const { nama } = payload;
  const kodeTrimmed = (kode || "").trim();
  const namaTrimmed = (nama || "").trim();

  if (!kodeTrimmed) {
    throw new Error("Kode pengguna harus disertakan.");
  }
  if (!namaTrimmed) {
    throw new Error("Nama pengguna harus diisi.");
  }

  const [res] = await pool.query(
    `UPDATE ga2.pengguna SET nama = ? WHERE kode = ?`,
    [namaTrimmed, kodeTrimmed],
  );

  if (res.affectedRows === 0) {
    throw new Error(`Data pengguna ${kodeTrimmed} tidak ditemukan.`);
  }

  // Sync ke bsmcabang.pengguna
  try {
    await pool.query(
      `UPDATE bsmcabang.pengguna SET nama = ? WHERE kode = ?`,
      [namaTrimmed, kodeTrimmed],
    );
  } catch (err) {
    console.warn("Sync update ke bsmcabang.pengguna warning:", err.message);
  }

  return { kode: kodeTrimmed, nama: namaTrimmed };
};

const deleteData = async (kode) => {
  const kodeTrimmed = (kode || "").trim();
  if (!kodeTrimmed) {
    throw new Error("Kode pengguna harus disertakan.");
  }

  const [res] = await pool.query(
    `DELETE FROM ga2.pengguna WHERE kode = ?`,
    [kodeTrimmed],
  );

  if (res.affectedRows === 0) {
    throw new Error(`Data pengguna ${kodeTrimmed} tidak ditemukan.`);
  }

  try {
    await pool.query(`DELETE FROM bsmcabang.pengguna WHERE kode = ?`, [
      kodeTrimmed,
    ]);
  } catch (err) {
    console.warn("Sync delete ke bsmcabang.pengguna warning:", err.message);
  }

  return { success: true };
};

module.exports = {
  getMaxKode,
  getAll,
  getById,
  create,
  update,
  deleteData,
};
