const db = require("../../config/database");

const getBrowse = async () => {
  const [rows] = await db.query(
    "SELECT bg_kode AS Kode, bg_nama AS Nama FROM tbahan_gramasi ORDER BY bg_kode ASC",
  );
  return rows;
};

const getById = async (kode) => {
  const [rows] = await db.query(
    "SELECT bg_kode AS Kode, bg_nama AS Nama FROM tbahan_gramasi WHERE bg_kode = ?",
    [kode],
  );
  return rows[0];
};

const create = async (data) => {
  // Cek duplikat
  const [existing] = await db.query(
    "SELECT bg_kode FROM tbahan_gramasi WHERE bg_kode = ?",
    [data.Kode],
  );
  if (existing.length > 0) {
    throw new Error(`Kode Gramasi [${data.Kode}] sudah ada di database.`);
  }

  await db.query(
    "INSERT INTO tbahan_gramasi (bg_kode, bg_nama) VALUES (?, ?)",
    [data.Kode, data.Nama],
  );
};

const update = async (kode, data) => {
  await db.query("UPDATE tbahan_gramasi SET bg_nama = ? WHERE bg_kode = ?", [
    data.Nama,
    kode,
  ]);
};

const remove = async (kode) => {
  // Pengecekan relasi ke tbahan (Sesuai dengan logika Delphi: mid(Bhn_kode, 6, 2))
  const [check] = await db.query(
    "SELECT Bhn_kode FROM tbahan WHERE MID(Bhn_kode, 6, 2) = ? LIMIT 1",
    [kode],
  );

  if (check.length > 0) {
    throw new Error(
      "Gramasi tsb sudah dipakai di Master Bahan. Tidak bisa dihapus.",
    );
  }

  await db.query("DELETE FROM tbahan_gramasi WHERE bg_kode = ?", [kode]);
};

module.exports = {
  getBrowse,
  getById,
  create,
  update,
  remove,
};
