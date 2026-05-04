const db = require("../../config/database");

const getBrowse = async (divisiId) => {
  // Filter berdasarkan hak akses Divisi User
  let filterDivisi = "";
  if (divisiId === 1) {
    filterDivisi = " WHERE (brg_divisi = 1 OR brg_divisi = 5) ";
  } else if (divisiId === 4) {
    filterDivisi = " WHERE (brg_divisi = 3 OR brg_divisi = 4) ";
  }

  const query = `
    SELECT 
      b.brg_Kode AS Kode, 
      v.Divisi AS DivisiNama, 
      b.brg_divisi AS DivisiId,
      b.brg_Name AS Nama, 
      b.brg_ukuran AS Ukuran, 
      b.brg_kain AS Kain,
      IFNULL((SELECT SUM(m.vStok) FROM vmasterstok_jadi m WHERE m.vKode = b.brg_kode), 0) AS Stok
    FROM tbarang b
    LEFT JOIN tdivisi v ON v.kode = b.brg_divisi
    ${filterDivisi}
    ORDER BY b.brg_Name ASC
  `;
  const [rows] = await db.query(query);
  return rows;
};

const getById = async (kode) => {
  const query = `
    SELECT 
      brg_kode AS Kode, 
      brg_name AS Nama, 
      brg_ukuran AS Ukuran, 
      brg_kain AS Kain, 
      brg_finishing AS Finishing,
      brg_stok AS StokAkhir,
      brg_hpp AS HargaHPP,
      brg_harga AS HargaJual,
      brg_divisi AS Divisi
    FROM tbarang 
    WHERE brg_kode = ?
  `;
  const [rows] = await db.query(query, [kode]);
  return rows.length > 0 ? rows[0] : null;
};

const create = async (data, user) => {
  // Cek apakah kode sudah dipakai (karena diinput manual)
  const [existing] = await db.query(
    "SELECT brg_kode FROM tbarang WHERE brg_kode = ?",
    [data.Kode],
  );
  if (existing.length > 0) throw new Error("Kode Barang sudah digunakan!");

  const query = `
    INSERT INTO tbarang (
      brg_kode, brg_name, brg_ukuran, brg_kain, brg_finishing, 
      brg_harga, brg_divisi, user_create, date_create
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
  `;

  await db.query(query, [
    data.Kode,
    data.Nama,
    data.Ukuran || "",
    data.Kain || "",
    data.Finishing || "",
    Number(data.HargaJual) || 0,
    Number(data.Divisi), // 1 untuk Spanduk, 4 untuk Garmen
    user,
  ]);
};

const update = async (kode, data, user) => {
  const query = `
    UPDATE tbarang SET 
      brg_name = ?, 
      brg_ukuran = ?, 
      brg_kain = ?, 
      brg_finishing = ?, 
      brg_harga = ?, 
      user_modified = ?, 
      date_modified = NOW()
    WHERE brg_kode = ?
  `;

  await db.query(query, [
    data.Nama,
    data.Ukuran || "",
    data.Kain || "",
    data.Finishing || "",
    Number(data.HargaJual) || 0,
    user,
    kode,
  ]);
};

module.exports = { getBrowse, getById, create, update };
