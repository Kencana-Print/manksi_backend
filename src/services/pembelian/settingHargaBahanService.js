const db = require("../../config/database");

// ========================================================
// 1. GARMEN KAIN (tmintaharga_kain)
// Kolom: mhk_kode, mhk_ktg, mhk_jeniskain, mhk_lengan, mhk_komponen, mhk_babaran, mhk_warna, mhk_harga, mhk_allow
// ========================================================
const getKainGarmen = async () => {
  const [rows] = await db.query(
    "SELECT * FROM tmintaharga_kain ORDER BY mhk_ktg ASC, mhk_jeniskain ASC, mhk_warna ASC"
  );
  return rows;
};

const createKainGarmen = async (data) => {
  const {
    mhk_kode = "",
    mhk_ktg = "",
    mhk_jeniskain = "",
    mhk_lengan = "",
    mhk_komponen = "",
    mhk_babaran = 0,
    mhk_warna = "",
    mhk_harga = 0,
    mhk_allow = 0,
  } = data;

  await db.query(
    `INSERT INTO tmintaharga_kain (
      mhk_kode, mhk_ktg, mhk_jeniskain, mhk_lengan, mhk_komponen,
      mhk_babaran, mhk_warna, mhk_harga, mhk_allow
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      mhk_kode,
      mhk_ktg,
      mhk_jeniskain,
      mhk_lengan,
      mhk_komponen,
      Number(mhk_babaran) || 0,
      mhk_warna,
      Number(mhk_harga) || 0,
      Number(mhk_allow) || 0,
    ]
  );
  return { success: true };
};

const updateKainGarmen = async (idOrKey, data) => {
  const {
    mhk_kode = "",
    mhk_ktg = "",
    mhk_jeniskain = "",
    mhk_lengan = "",
    mhk_komponen = "",
    mhk_babaran = 0,
    mhk_warna = "",
    mhk_harga = 0,
    mhk_allow = 0,
    old_jeniskain,
    old_warna,
    old_komponen,
    old_lengan,
  } = data;

  await db.query(
    `UPDATE tmintaharga_kain SET
      mhk_kode = ?,
      mhk_ktg = ?,
      mhk_jeniskain = ?,
      mhk_lengan = ?,
      mhk_komponen = ?,
      mhk_babaran = ?,
      mhk_warna = ?,
      mhk_harga = ?,
      mhk_allow = ?
    WHERE mhk_jeniskain = ? AND mhk_warna = ? AND mhk_komponen = ? AND mhk_lengan = ?`,
    [
      mhk_kode,
      mhk_ktg,
      mhk_jeniskain,
      mhk_lengan,
      mhk_komponen,
      Number(mhk_babaran) || 0,
      mhk_warna,
      Number(mhk_harga) || 0,
      Number(mhk_allow) || 0,
      old_jeniskain || mhk_jeniskain,
      old_warna || mhk_warna,
      old_komponen || mhk_komponen,
      old_lengan || mhk_lengan,
    ]
  );
  return { success: true };
};

const deleteKainGarmen = async (data) => {
  const { mhk_jeniskain, mhk_warna, mhk_komponen, mhk_lengan } = data;
  await db.query(
    `DELETE FROM tmintaharga_kain 
     WHERE mhk_jeniskain = ? AND mhk_warna = ? AND mhk_komponen = ? AND mhk_lengan = ?`,
    [mhk_jeniskain, mhk_warna, mhk_komponen || "", mhk_lengan || ""]
  );
  return { success: true };
};

// ========================================================
// 2. GARMEN TAMBAHAN / CUSTOM (tmintaharga_tambahan)
// Kolom: mht_ket, mht_lacost, mht_cotton, mht_pe
// ========================================================
const getTambahanGarmen = async () => {
  const [rows] = await db.query(
    "SELECT * FROM tmintaharga_tambahan ORDER BY mht_ket ASC"
  );
  return rows;
};

const createTambahanGarmen = async (data) => {
  const { mht_ket, mht_lacost = 0, mht_cotton = 0, mht_pe = 0 } = data;
  await db.query(
    `INSERT INTO tmintaharga_tambahan (mht_ket, mht_lacost, mht_cotton, mht_pe)
     VALUES (?, ?, ?, ?)`,
    [
      mht_ket,
      Number(mht_lacost) || 0,
      Number(mht_cotton) || 0,
      Number(mht_pe) || 0,
    ]
  );
  return { success: true };
};

const updateTambahanGarmen = async (oldKet, data) => {
  const { mht_ket, mht_lacost = 0, mht_cotton = 0, mht_pe = 0 } = data;
  await db.query(
    `UPDATE tmintaharga_tambahan SET
      mht_ket = ?,
      mht_lacost = ?,
      mht_cotton = ?,
      mht_pe = ?
     WHERE mht_ket = ?`,
    [
      mht_ket,
      Number(mht_lacost) || 0,
      Number(mht_cotton) || 0,
      Number(mht_pe) || 0,
      oldKet,
    ]
  );
  return { success: true };
};

const deleteTambahanGarmen = async (mht_ket) => {
  await db.query("DELETE FROM tmintaharga_tambahan WHERE mht_ket = ?", [mht_ket]);
  return { success: true };
};

// ========================================================
// 3. SPANDUK (tmintaharga_spanduk)
// Kolom: mhsp_id, mhsp_metode, mhsp_lebar, mhsp_jenis_kain, mhsp_qmin, mhsp_qmax, mhsp_harga, mhsp_user_create, mhsp_date_create
// ========================================================
const getSpanduk = async () => {
  const [rows] = await db.query(`
    SELECT 
      mhsp_id AS id,
      mhsp_metode AS metode,
      mhsp_lebar AS lebar,
      mhsp_jenis_kain AS jenis_kain,
      mhsp_qmin AS qmin,
      mhsp_qmax AS qmax,
      mhsp_harga AS harga,
      mhsp_user_create AS user_create,
      mhsp_date_create AS date_create
    FROM tmintaharga_spanduk 
    ORDER BY mhsp_metode ASC, mhsp_lebar ASC, mhsp_jenis_kain ASC, mhsp_qmin ASC
  `);
  return rows;
};

const createSpanduk = async (data, user) => {
  const {
    metode = "MANUAL",
    lebar = 90,
    jenis_kain = "POLYESTER 50/36",
    qmin = 0,
    qmax = 999999,
    harga = 0,
  } = data;

  const [res] = await db.query(
    `INSERT INTO tmintaharga_spanduk (
      mhsp_metode, mhsp_lebar, mhsp_jenis_kain, mhsp_qmin, mhsp_qmax, mhsp_harga, mhsp_user_create, mhsp_date_create
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      metode,
      Number(lebar) || 90,
      jenis_kain,
      Number(qmin) || 0,
      Number(qmax) || 999999,
      Number(harga) || 0,
      user?.nama || "ADMIN",
    ]
  );
  return { id: res.insertId };
};

const updateSpanduk = async (id, data) => {
  const { metode, lebar, jenis_kain, qmin, qmax, harga } = data;
  await db.query(
    `UPDATE tmintaharga_spanduk SET
      mhsp_metode = ?,
      mhsp_lebar = ?,
      mhsp_jenis_kain = ?,
      mhsp_qmin = ?,
      mhsp_qmax = ?,
      mhsp_harga = ?
     WHERE mhsp_id = ?`,
    [
      metode,
      Number(lebar) || 90,
      jenis_kain,
      Number(qmin) || 0,
      Number(qmax) || 999999,
      Number(harga) || 0,
      id,
    ]
  );
  return { success: true };
};

const deleteSpanduk = async (id) => {
  await db.query("DELETE FROM tmintaharga_spanduk WHERE mhsp_id = ?", [id]);
  return { success: true };
};

// ========================================================
// 4. MMT BAHAN (tmintaharga_mmt)
// Kolom: mhm_id, mhm_kategori, mhm_bahan_kode, mhm_nama_bahan, mhm_qmin, mhm_qmax, mhm_harga, mhm_is_netto, mhm_resolusi_tipe
// ========================================================
const getMmt = async () => {
  const [rows] = await db.query(`
    SELECT 
      mhm_id AS id,
      mhm_kategori AS kategori,
      mhm_bahan_kode AS bahan_kode,
      mhm_nama_bahan AS nama_bahan,
      mhm_qmin AS qmin,
      mhm_qmax AS qmax,
      mhm_harga AS harga,
      mhm_is_netto AS is_netto,
      mhm_resolusi_tipe AS resolusi_tipe,
      mhm_user_create AS user_create,
      mhm_date_create AS date_create
    FROM tmintaharga_mmt 
    ORDER BY mhm_kategori ASC, mhm_bahan_kode ASC, mhm_qmin ASC
  `);
  return rows;
};

const createMmt = async (data, user) => {
  const {
    kategori = "VYNIL",
    bahan_kode = "260",
    nama_bahan = "",
    qmin = 0,
    qmax = 999999,
    harga = 0,
    is_netto = 0,
    resolusi_tipe = "",
  } = data;

  const [res] = await db.query(
    `INSERT INTO tmintaharga_mmt (
      mhm_kategori, mhm_bahan_kode, mhm_nama_bahan, mhm_qmin, mhm_qmax, mhm_harga, mhm_is_netto, mhm_resolusi_tipe, mhm_user_create, mhm_date_create
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      kategori,
      bahan_kode,
      nama_bahan,
      Number(qmin) || 0,
      Number(qmax) || 999999,
      Number(harga) || 0,
      is_netto ? 1 : 0,
      resolusi_tipe || "",
      user?.nama || "ADMIN",
    ]
  );
  return { id: res.insertId };
};

const updateMmt = async (id, data) => {
  const {
    kategori,
    bahan_kode,
    nama_bahan,
    qmin,
    qmax,
    harga,
    is_netto,
    resolusi_tipe,
  } = data;

  await db.query(
    `UPDATE tmintaharga_mmt SET
      mhm_kategori = ?,
      mhm_bahan_kode = ?,
      mhm_nama_bahan = ?,
      mhm_qmin = ?,
      mhm_qmax = ?,
      mhm_harga = ?,
      mhm_is_netto = ?,
      mhm_resolusi_tipe = ?
     WHERE mhm_id = ?`,
    [
      kategori,
      bahan_kode,
      nama_bahan,
      Number(qmin) || 0,
      Number(qmax) || 999999,
      Number(harga) || 0,
      is_netto ? 1 : 0,
      resolusi_tipe || "",
      id,
    ]
  );
  return { success: true };
};

const deleteMmt = async (id) => {
  await db.query("DELETE FROM tmintaharga_mmt WHERE mhm_id = ?", [id]);
  return { success: true };
};

// ========================================================
// 5. MMT TAMBAHAN / TOPPING (tmintaharga_mmt_tambahan)
// Kolom: mhmt_id, mhmt_kode, mhmt_nama, mhmt_kategori, mhmt_ukuran, mhmt_material, mhmt_harga, mhmt_aktif
// ========================================================
const getMmtTambahan = async () => {
  const [rows] = await db.query(`
    SELECT 
      mhmt_id AS id,
      mhmt_kode AS kode,
      mhmt_nama AS nama,
      mhmt_kategori AS kategori,
      mhmt_ukuran AS ukuran,
      mhmt_material AS material,
      mhmt_harga AS harga,
      mhmt_aktif AS aktif,
      mhmt_user_create AS user_create,
      mhmt_date_create AS date_create
    FROM tmintaharga_mmt_tambahan 
    ORDER BY mhmt_kategori ASC, mhmt_nama ASC
  `);
  return rows;
};

const createMmtTambahan = async (data, user) => {
  const {
    kode,
    nama,
    kategori = "STANDING_BANNER",
    ukuran = "",
    material = "-",
    harga = 0,
    aktif = 1,
  } = data;

  const [res] = await db.query(
    `INSERT INTO tmintaharga_mmt_tambahan (
      mhmt_kode, mhmt_nama, mhmt_kategori, mhmt_ukuran, mhmt_material, mhmt_harga, mhmt_aktif, mhmt_user_create, mhmt_date_create
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      kode,
      nama,
      kategori,
      ukuran,
      material,
      Number(harga) || 0,
      aktif ? 1 : 0,
      user?.nama || "ADMIN",
    ]
  );
  return { id: res.insertId };
};

const updateMmtTambahan = async (id, data) => {
  const { kode, nama, kategori, ukuran, material, harga, aktif } = data;
  await db.query(
    `UPDATE tmintaharga_mmt_tambahan SET
      mhmt_kode = ?,
      mhmt_nama = ?,
      mhmt_kategori = ?,
      mhmt_ukuran = ?,
      mhmt_material = ?,
      mhmt_harga = ?,
      mhmt_aktif = ?
     WHERE mhmt_id = ?`,
    [
      kode,
      nama,
      kategori,
      ukuran,
      material,
      Number(harga) || 0,
      aktif ? 1 : 0,
      id,
    ]
  );
  return { success: true };
};

const deleteMmtTambahan = async (id) => {
  await db.query("DELETE FROM tmintaharga_mmt_tambahan WHERE mhmt_id = ?", [id]);
  return { success: true };
};

module.exports = {
  getKainGarmen,
  createKainGarmen,
  updateKainGarmen,
  deleteKainGarmen,
  getTambahanGarmen,
  createTambahanGarmen,
  updateTambahanGarmen,
  deleteTambahanGarmen,
  getSpanduk,
  createSpanduk,
  updateSpanduk,
  deleteSpanduk,
  getMmt,
  createMmt,
  updateMmt,
  deleteMmt,
  getMmtTambahan,
  createMmtTambahan,
  updateMmtTambahan,
  deleteMmtTambahan,
};
