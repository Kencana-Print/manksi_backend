const db = require("../../config/database");

const getBrowse = async () => {
  const query =
    "SELECT aw_kode AS Kode, aw_nama AS Nama FROM taccesories_warna ORDER BY aw_kode ASC";
  const [rows] = await db.query(query);
  return rows;
};

const getById = async (kode) => {
  const query =
    "SELECT aw_kode AS Kode, aw_nama AS Nama FROM taccesories_warna WHERE aw_kode = ?";
  const [rows] = await db.query(query, [kode]);
  return rows[0];
};

const create = async (data) => {
  // Cek duplikat
  const [exist] = await db.query(
    "SELECT aw_kode FROM taccesories_warna WHERE aw_kode = ?",
    [data.Kode],
  );
  if (exist.length > 0) throw new Error("Kode Warna Accesories sudah ada.");

  const query =
    "INSERT INTO taccesories_warna (aw_kode, aw_nama) VALUES (?, ?)";
  await db.query(query, [data.Kode, data.Nama]);
};

const update = async (kode, data) => {
  const query = "UPDATE taccesories_warna SET aw_nama = ? WHERE aw_kode = ?";
  await db.query(query, [data.Nama, kode]);
};

const remove = async (kode) => {
  // Pengecekan relasi ke tabel taccesories (Sesuai dengan logika Delphi)
  const [check] = await db.query(
    "SELECT acc_kode FROM taccesories WHERE MID(acc_kode, 3, 3) = ? LIMIT 1",
    [kode],
  );

  if (check.length > 0) {
    throw new Error(
      "Warna tersebut sudah dipakai di Master Accesories. Tidak bisa dihapus.",
    );
  }

  await db.query("DELETE FROM taccesories_warna WHERE aw_kode = ?", [kode]);
};

module.exports = { getBrowse, getById, create, update, remove };
