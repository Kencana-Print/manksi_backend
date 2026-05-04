const db = require("../../config/database");

const getBrowse = async () => {
  const [rows] = await db.query(
    "SELECT bw_kode AS Kode, bw_nama AS Nama FROM tbahan_warna ORDER BY bw_kode ASC",
  );
  return rows;
};

const getById = async (kode) => {
  const [rows] = await db.query(
    "SELECT bw_kode AS Kode, bw_nama AS Nama FROM tbahan_warna WHERE bw_kode = ?",
    [kode],
  );
  return rows[0];
};

const create = async (data) => {
  // Cek duplikat
  const [existing] = await db.query(
    "SELECT bw_kode FROM tbahan_warna WHERE bw_kode = ?",
    [data.Kode],
  );
  if (existing.length > 0) {
    throw new Error(`Kode Warna [${data.Kode}] sudah ada di database.`);
  }

  await db.query("INSERT INTO tbahan_warna (bw_kode, bw_nama) VALUES (?, ?)", [
    data.Kode,
    data.Nama,
  ]);
};

const update = async (kode, data) => {
  await db.query("UPDATE tbahan_warna SET bw_nama = ? WHERE bw_kode = ?", [
    data.Nama,
    kode,
  ]);
};

const remove = async (kode) => {
  // Pengecekan relasi ke tbahan (Sesuai dengan logika Delphi: mid(Bhn_kode, 3, 3))
  const [check] = await db.query(
    "SELECT Bhn_kode FROM tbahan WHERE MID(Bhn_kode, 3, 3) = ? LIMIT 1",
    [kode],
  );

  if (check.length > 0) {
    throw new Error(
      "Warna tersebut sudah dipakai di Master Bahan. Tidak bisa dihapus.",
    );
  }

  await db.query("DELETE FROM tbahan_warna WHERE bw_kode = ?", [kode]);
};

module.exports = {
  getBrowse,
  getById,
  create,
  update,
  remove,
};
