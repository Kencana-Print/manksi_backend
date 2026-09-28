const db = require("../../config/database");

const getAll = async () => {
  const [rows] = await db.query(
    `SELECT jenisbayar AS nama FROM finance.tjenisbayar ORDER BY jenisbayar`,
  );
  return rows;
};

const saveData = async ({ nama }) => {
  if (!nama?.trim()) throw new Error("Jenis pembayaran harus diisi.");

  const [[cek]] = await db.query(
    `SELECT COUNT(*) AS c FROM finance.tjenisbayar WHERE jenisbayar = ?`,
    [nama.trim()],
  );
  if (cek.c > 0) throw new Error(`"${nama.trim()}" sudah ada.`);

  await db.query(`INSERT INTO finance.tjenisbayar (jenisbayar) VALUES (?)`, [
    nama.trim(),
  ]);
  return { nama: nama.trim() };
};

const deleteData = async (nama) => {
  const [[cek]] = await db.query(
    `SELECT COUNT(*) AS c FROM finance.tjenisbayar WHERE jenisbayar = ?`,
    [nama],
  );
  if (cek.c === 0) throw new Error("Data tidak ditemukan.");

  await db.query(`DELETE FROM finance.tjenisbayar WHERE jenisbayar = ?`, [
    nama,
  ]);
};

module.exports = { getAll, saveData, deleteData };
