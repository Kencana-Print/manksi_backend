const db = require("../../config/database");

const getBrowse = async () => {
  // Sesuai dengan Lookup di Master Bahan: tbahan_jenis
  const [rows] = await db.query(
    "SELECT bj_kode AS Kode, bj_nama AS Nama FROM tbahan_jenis ORDER BY bj_kode ASC",
  );
  return rows;
};

const getById = async (kode) => {
  const [rows] = await db.query(
    "SELECT bj_kode AS Kode, bj_nama AS Nama FROM tbahan_jenis WHERE bj_kode = ?",
    [kode],
  );
  return rows[0];
};

const create = async (data) => {
  // Cek Duplikat di tbahan_jenis
  const [existing] = await db.query(
    "SELECT bj_kode FROM tbahan_jenis WHERE bj_kode = ?",
    [data.Kode],
  );
  if (existing.length > 0) {
    throw new Error(`Kode Jenis [${data.Kode}] sudah ada.`);
  }

  await db.query("INSERT INTO tbahan_jenis (bj_kode, bj_nama) VALUES (?, ?)", [
    data.Kode,
    data.Nama,
  ]);
};

const update = async (kode, data) => {
  await db.query("UPDATE tbahan_jenis SET bj_nama = ? WHERE bj_kode = ?", [
    data.Nama,
    kode,
  ]);
};

const remove = async (kode) => {
  // Karena ini tabel referensi penting, pastikan tidak sedang dipakai di tbahan sebelum hapus
  const [check] = await db.query(
    "SELECT bhn_kode FROM tbahan WHERE LEFT(bhn_kode, 2) = ? LIMIT 1",
    [kode],
  );
  if (check.length > 0) {
    throw new Error(
      "Tidak bisa dihapus karena jenis ini sudah digunakan oleh data Master Bahan.",
    );
  }

  await db.query("DELETE FROM tbahan_jenis WHERE bj_kode = ?", [kode]);
};

module.exports = { getBrowse, getById, create, update, remove };
