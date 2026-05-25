const db = require("../../config/database");

const getBrowse = async () => {
  const query =
    "SELECT ak_kode AS Kode, ak_nama AS Nama FROM taccesories_ket ORDER BY ak_kode ASC";
  const [rows] = await db.query(query);
  return rows;
};

const getById = async (kode) => {
  const query =
    "SELECT ak_kode AS Kode, ak_nama AS Nama FROM taccesories_ket WHERE ak_kode = ?";
  const [rows] = await db.query(query, [kode]);
  return rows[0];
};

const create = async (data) => {
  // Cek duplikat
  const [exist] = await db.query(
    "SELECT ak_kode FROM taccesories_ket WHERE ak_kode = ?",
    [data.Kode],
  );
  if (exist.length > 0)
    throw new Error("Kode Keterangan Accesories sudah ada.");

  const query = "INSERT INTO taccesories_ket (ak_kode, ak_nama) VALUES (?, ?)";
  await db.query(query, [data.Kode, data.Nama]);
};

const update = async (kode, data) => {
  const query = "UPDATE taccesories_ket SET ak_nama = ? WHERE ak_kode = ?";
  await db.query(query, [data.Nama, kode]);
};

const remove = async (kode) => {
  // Cek apakah keterangan sudah dipakai di master accesories
  const [check] = await db.query(
    `
      SELECT brg_kode
      FROM tgarmen_brg
      WHERE brg_jenis = 'ACCESORIES'
        AND MID(brg_kode, 9, 2) = ?
      LIMIT 1
    `,
    [kode],
  );

  if (check.length > 0) {
    throw new Error(
      "Keterangan tersebut sudah dipakai di Master Accesories. Tidak bisa dihapus.",
    );
  }

  await db.query("DELETE FROM taccesories_ket WHERE ak_kode = ?", [kode]);
};

module.exports = { getBrowse, getById, create, update, remove };
