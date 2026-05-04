const db = require("../../config/database");

const getBrowse = async () => {
  const query =
    "SELECT au_kode AS Kode, au_nama AS Nama FROM taccesories_ukuran ORDER BY au_kode ASC";
  const [rows] = await db.query(query);
  return rows;
};

const getById = async (kode) => {
  const query =
    "SELECT au_kode AS Kode, au_nama AS Nama FROM taccesories_ukuran WHERE au_kode = ?";
  const [rows] = await db.query(query, [kode]);
  return rows[0];
};

const create = async (data) => {
  // Cek duplikat
  const [exist] = await db.query(
    "SELECT au_kode FROM taccesories_ukuran WHERE au_kode = ?",
    [data.Kode],
  );
  if (exist.length > 0) throw new Error("Kode Ukuran Accesories sudah ada.");

  const query =
    "INSERT INTO taccesories_ukuran (au_kode, au_nama) VALUES (?, ?)";
  await db.query(query, [data.Kode, data.Nama]);
};

const update = async (kode, data) => {
  const query = "UPDATE taccesories_ukuran SET au_nama = ? WHERE au_kode = ?";
  await db.query(query, [data.Nama, kode]);
};

const remove = async (kode) => {
  // Pengecekan relasi ke tabel taccesories: MID(acc_kode, 6, 3)
  const [check] = await db.query(
    "SELECT acc_kode FROM taccesories WHERE MID(acc_kode, 6, 3) = ? LIMIT 1",
    [kode],
  );

  if (check.length > 0) {
    throw new Error(
      "Ukuran tersebut sudah dipakai di Master Accesories. Tidak bisa dihapus.",
    );
  }

  await db.query("DELETE FROM taccesories_ukuran WHERE au_kode = ?", [kode]);
};

module.exports = { getBrowse, getById, create, update, remove };
