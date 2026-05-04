const db = require("../../config/database");

const getBrowse = async () => {
  // Hanya ambil data tbahan dengan bhn_jb_kode = 'LL' (Lain-Lain)
  const query = `
    SELECT 
      bhn_kode AS Kode, 
      bhn_name AS Nama, 
      bhn_satuan AS Satuan, 
      bhn_gramasi AS Gramasi, 
      bhn_setting AS Setting, 
      bhn_jb_kode AS Jenis,
      bhn_aktif AS Aktif
    FROM tbahan
    WHERE bhn_jb_kode = 'LL' AND bhn_aktif = 0
    ORDER BY bhn_kode ASC
  `;
  const [rows] = await db.query(query);
  return rows;
};

const getById = async (kode) => {
  const query = `
    SELECT 
      bhn_kode AS Kode, 
      bhn_name AS Nama, 
      bhn_satuan AS Satuan, 
      bhn_gramasi AS Gramasi, 
      bhn_setting AS Setting, 
      bhn_jb_kode AS JenisBahan,
      bhn_stok AS StokAkhir,
      bhn_avgcost AS AvgCost,
      bhn_hargabeli AS HargaBeli,
      bhn_aktif AS Aktif
    FROM tbahan 
    WHERE bhn_kode = ? AND bhn_jb_kode = 'LL'
  `;
  const [rows] = await db.query(query, [kode]);
  return rows[0];
};

const create = async (data, user) => {
  // Cek duplikat
  const [exist] = await db.query(
    "SELECT bhn_kode FROM tbahan WHERE bhn_kode = ?",
    [data.Kode],
  );
  if (exist.length > 0) throw new Error("Kode Komponen sudah ada.");

  const aktifStatus = data.Aktif === "Y" ? 0 : 1; // Di tbahan, 0 = Aktif, 1 = Pasif

  const query = `
    INSERT INTO tbahan 
    (bhn_kode, bhn_name, bhn_satuan, bhn_jb_kode, bhn_setting, bhn_gramasi, bhn_hargabeli, bhn_aktif, user_create, date_create) 
    VALUES (?, ?, ?, 'LL', ?, ?, ?, ?, ?, NOW())
  `;
  await db.query(query, [
    data.Kode,
    data.Nama,
    data.Satuan || "PCS",
    data.Setting || "",
    data.Gramasi || "",
    data.HargaBeli || 0,
    aktifStatus,
    user,
  ]);
};

const update = async (kode, data, user) => {
  const aktifStatus = data.Aktif === "Y" ? 0 : 1;

  const query = `
    UPDATE tbahan SET 
      bhn_name = ?, 
      bhn_satuan = ?, 
      bhn_setting = ?, 
      bhn_gramasi = ?, 
      bhn_hargabeli = ?, 
      bhn_aktif = ?, 
      user_modified = ?, 
      date_modified = NOW() 
    WHERE bhn_kode = ?
  `;
  await db.query(query, [
    data.Nama,
    data.Satuan || "PCS",
    data.Setting || "",
    data.Gramasi || "",
    data.HargaBeli || 0,
    aktifStatus,
    user,
    kode,
  ]);
};

module.exports = { getBrowse, getById, create, update };
