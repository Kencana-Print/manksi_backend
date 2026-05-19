const db = require("../../config/database");

// --- GET DATA BROWSE (Delphi: btnRefreshClick) ---
const getBrowse = async () => {
  const query = `
    SELECT 
      user_kode AS Kode, 
      user_nama AS Nama, 
      IF(user_aktif = 0, "YA", "TIDAK") AS Aktif 
    FROM tuser 
    ORDER BY user_nama ASC
  `;
  const [rows] = await db.query(query);
  return rows;
};

// --- GET BY ID (Persiapan untuk form ubah) ---
const getById = async (kode) => {
  const query = `SELECT * FROM tuser WHERE user_kode = ?`;
  const [rows] = await db.query(query, [kode]);
  return rows.length > 0 ? rows[0] : null;
};

// Persiapan untuk Insert/Update (akan didetailkan di form)
const save = async (data, isNewMode) => {
  // Logic save / update tuser dan thakuser akan ditaruh di sini nanti
};

module.exports = {
  getBrowse,
  getById,
  save,
};
