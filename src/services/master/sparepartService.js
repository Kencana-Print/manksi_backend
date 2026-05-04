const db = require("../../config/database");

const getBrowse = async () => {
  const query = `
    SELECT 
      b.sp_kode AS Kode, 
      b.sp_nama AS Nama, 
      b.sp_satuan AS Satuan,
      IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok_sparepart m WHERE m.mst_aktif='Y' AND m.mst_brg_kode=b.sp_kode), 0) AS Stok
    FROM tsparepart b
    ORDER BY b.sp_nama ASC
  `;
  const [rows] = await db.query(query);
  return rows;
};

const getById = async (kode) => {
  const query =
    "SELECT sp_kode AS Kode, sp_nama AS Nama, sp_satuan AS Satuan FROM tsparepart WHERE sp_kode = ?";
  const [rows] = await db.query(query, [kode]);
  return rows[0];
};

const create = async (data, user) => {
  // Validasi panjang kode (harus 7 digit sesuai Delphi)
  if (!data.Kode || data.Kode.trim().length !== 7) {
    throw new Error("Kode sparepart harus 7 digit.");
  }

  // Cek duplikat
  const [exist] = await db.query(
    "SELECT sp_kode FROM tsparepart WHERE sp_kode = ?",
    [data.Kode],
  );
  if (exist.length > 0) throw new Error("Kode Sparepart sudah ada.");

  const query = `
    INSERT INTO tsparepart (sp_kode, sp_nama, sp_satuan, user_create, date_create) 
    VALUES (?, ?, ?, ?, NOW())
  `;
  await db.query(query, [data.Kode, data.Nama, data.Satuan || "PCS", user]);
};

const update = async (kode, data, user) => {
  const query = `
    UPDATE tsparepart SET 
      sp_nama = ?, 
      sp_satuan = ?, 
      user_modified = ?, 
      date_modified = NOW() 
    WHERE sp_kode = ?
  `;
  await db.query(query, [data.Nama, data.Satuan || "PCS", user, kode]);
};

// Tidak ada remove() karena di referensi Delphi tidak ada tombol hapus

module.exports = { getBrowse, getById, create, update };
