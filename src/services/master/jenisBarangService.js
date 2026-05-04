const db = require("../../config/database");

const getBrowse = async () => {
  const query = `
    SELECT jb_kode AS Kode, jb_nama AS Nama 
    FROM tjenisbarang 
    ORDER BY jb_nama ASC
  `;
  const [rows] = await db.query(query);
  return rows;
};

const getById = async (kode) => {
  const query = `
    SELECT jb_kode AS Kode, jb_nama AS Nama 
    FROM tjenisbarang 
    WHERE jb_kode = ?
  `;
  const [rows] = await db.query(query, [kode]);
  return rows.length > 0 ? rows[0] : null;
};

const create = async (data) => {
  // Pengecekan kode ganda
  const [existing] = await db.query(
    "SELECT jb_kode FROM tjenisbarang WHERE jb_kode = ?",
    [data.Kode],
  );
  if (existing.length > 0)
    throw new Error(`Kode Jenis Barang '${data.Kode}' sudah ada!`);

  const query = `INSERT INTO tjenisbarang (jb_kode, jb_nama) VALUES (?, ?)`;
  await db.query(query, [data.Kode, data.Nama]);
};

const update = async (kode, data) => {
  const query = `UPDATE tjenisbarang SET jb_nama = ? WHERE jb_kode = ?`;
  await db.query(query, [data.Nama, kode]);
};

module.exports = { getBrowse, getById, create, update };
