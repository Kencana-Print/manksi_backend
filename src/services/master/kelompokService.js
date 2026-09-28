const db = require("../../config/database");

const getAll = async () => {
  const [rows] = await db.query(
    `SELECT kol_id AS kode, kol_nama AS nama, kol_ket AS keterangan
     FROM finance.tkelompok ORDER BY kol_id`,
  );
  return rows;
};

const getById = async (kode) => {
  const [[row]] = await db.query(
    `SELECT kol_id AS kode, kol_nama AS nama, kol_ket AS keterangan
     FROM finance.tkelompok WHERE kol_id = ?`,
    [kode],
  );
  if (!row) throw new Error("Kelompok tidak ditemukan.");
  return row;
};

const saveData = async (payload) => {
  const { isEdit, kode, nama, keterangan } = payload;

  if (!kode || !String(kode).trim()) throw new Error("Kode wajib diisi.");
  if (!nama || !String(nama).trim()) throw new Error("Nama wajib diisi.");

  if (isEdit) {
    await db.query(
      `UPDATE finance.tkelompok SET kol_nama = ?, kol_ket = ? WHERE kol_id = ?`,
      [nama, keterangan || "", kode],
    );
  } else {
    const [[cek]] = await db.query(
      `SELECT COUNT(*) AS c FROM finance.tkelompok WHERE kol_id = ?`,
      [kode],
    );
    if (cek.c > 0) throw new Error(`Kode "${kode}" sudah ada.`);

    await db.query(
      `INSERT INTO finance.tkelompok (kol_id, kol_nama, kol_ket) VALUES (?, ?, ?)`,
      [kode, nama, keterangan || ""],
    );
  }
  return { kode };
};

const deleteData = async (kode) => {
  // Cek apakah sudah dipakai di trekening
  const [[cek]] = await db.query(
    `SELECT COUNT(*) AS c FROM finance.trekening WHERE rek_kol_id = ?`,
    [kode],
  );
  if (cek.c > 0)
    throw new Error(
      "Kelompok ini sudah dipakai di data Rekening. Tidak bisa dihapus.",
    );

  await db.query(`DELETE FROM finance.tkelompok WHERE kol_id = ?`, [kode]);
};

module.exports = { getAll, getById, saveData, deleteData };
