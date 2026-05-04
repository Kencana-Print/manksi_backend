const db = require("../../config/database");

const getBrowse = async () => {
  const query = `
    SELECT jo_kode AS Kode, jo_nama AS Nama 
    FROM tjenisorder 
    ORDER BY jo_nama ASC
  `;
  const [rows] = await db.query(query);
  return rows;
};

const getById = async (kode) => {
  const query = `
    SELECT jo_kode AS Kode, jo_nama AS Nama 
    FROM tjenisorder 
    WHERE jo_kode = ?
  `;
  const [rows] = await db.query(query, [kode]);
  return rows.length > 0 ? rows[0] : null;
};

const create = async (data) => {
  const [existing] = await db.query(
    "SELECT jo_kode FROM tjenisorder WHERE jo_kode = ?",
    [data.Kode],
  );
  if (existing.length > 0)
    throw new Error(`Kode Jenis Order '${data.Kode}' sudah ada!`);

  const query = `INSERT INTO tjenisorder (jo_kode, jo_nama) VALUES (?, ?)`;
  await db.query(query, [data.Kode, data.Nama]);
};

const update = async (kode, data) => {
  const query = `UPDATE tjenisorder SET jo_nama = ? WHERE jo_kode = ?`;
  await db.query(query, [data.Nama, kode]);
};

module.exports = { getBrowse, getById, create, update };
