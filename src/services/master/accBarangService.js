const db = require("../../config/database");

const getBrowse = async () => {
  const query =
    "SELECT ab_kode AS Kode, ab_nama AS Nama FROM taccesories_barang ORDER BY ab_kode ASC";
  const [rows] = await db.query(query);
  return rows;
};

const getById = async (kode) => {
  const query =
    "SELECT ab_kode AS Kode, ab_nama AS Nama FROM taccesories_barang WHERE ab_kode = ?";
  const [rows] = await db.query(query, [kode]);
  return rows[0];
};

const create = async (data) => {
  // Cek duplikat
  const [exist] = await db.query(
    "SELECT ab_kode FROM taccesories_barang WHERE ab_kode = ?",
    [data.Kode],
  );
  if (exist.length > 0) throw new Error("Kode Barang Accesories sudah ada.");

  const query =
    "INSERT INTO taccesories_barang (ab_kode, ab_nama) VALUES (?, ?)";
  await db.query(query, [data.Kode, data.Nama]);
};

const update = async (kode, data) => {
  const query = "UPDATE taccesories_barang SET ab_nama = ? WHERE ab_kode = ?";
  await db.query(query, [data.Nama, kode]);
};

const remove = async (kode) => {
  // Cek apakah sudah dipakai di master accesories
  const [check] = await db.query(
    "SELECT brg_kode FROM tgarmen_brg WHERE LEFT(brg_kode, 2) = ? LIMIT 1",
    [kode],
  );

  if (check.length > 0) {
    throw new Error(
      "Barang tersebut sudah dipakai di Master Accesories. Tidak bisa dihapus.",
    );
  }

  await db.query("DELETE FROM taccesories_barang WHERE ab_kode = ?", [kode]);
};

module.exports = { getBrowse, getById, create, update, remove };
