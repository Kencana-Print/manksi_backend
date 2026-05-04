const db = require("../../config/database");

const getBrowse = async () => {
  const [rows] = await db.query(
    "SELECT bs_kode AS Kode, bs_nama AS Nama FROM tbahan_setting ORDER BY bs_kode ASC",
  );
  return rows;
};

const getById = async (kode) => {
  const [rows] = await db.query(
    "SELECT bs_kode AS Kode, bs_nama AS Nama FROM tbahan_setting WHERE bs_kode = ?",
    [kode],
  );
  return rows[0];
};

const create = async (data) => {
  // Cek duplikat
  const [existing] = await db.query(
    "SELECT bs_kode FROM tbahan_setting WHERE bs_kode = ?",
    [data.Kode],
  );
  if (existing.length > 0) {
    throw new Error(`Kode Setting [${data.Kode}] sudah ada di database.`);
  }

  await db.query(
    "INSERT INTO tbahan_setting (bs_kode, bs_nama) VALUES (?, ?)",
    [data.Kode, data.Nama],
  );
};

const update = async (kode, data) => {
  await db.query("UPDATE tbahan_setting SET bs_nama = ? WHERE bs_kode = ?", [
    data.Nama,
    kode,
  ]);
};

const remove = async (kode) => {
  // Pengecekan relasi ke tbahan (Sesuai dengan logika Delphi: right(Bhn_kode, 2))
  const [check] = await db.query(
    "SELECT Bhn_kode FROM tbahan WHERE RIGHT(Bhn_kode, 2) = ? LIMIT 1",
    [kode],
  );

  if (check.length > 0) {
    throw new Error(
      "Setting tsb sudah dipakai di Master Bahan. Tidak bisa dihapus.",
    );
  }

  await db.query("DELETE FROM tbahan_setting WHERE bs_kode = ?", [kode]);
};

module.exports = {
  getBrowse,
  getById,
  create,
  update,
  remove,
};
