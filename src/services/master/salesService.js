const db = require("../../config/database");

const getBrowse = async () => {
  const query = `
    SELECT 
      sal_kode AS Kode, 
      sal_nama AS Nama, 
      sal_alamat AS Alamat, 
      sal_kota AS Kota, 
      sal_telp AS Telp, 
      sal_aktif AS Aktif
    FROM tsales 
    ORDER BY sal_nama ASC
  `;
  const [rows] = await db.query(query);
  return rows;
};

const getById = async (kode) => {
  const query = `
    SELECT 
      sal_kode AS Kode, 
      sal_nama AS Nama, 
      sal_alamat AS Alamat, 
      sal_kota AS Kota, 
      sal_telp AS Telp, 
      sal_aktif AS Aktif
    FROM tsales 
    WHERE sal_kode = ?
  `;
  const [rows] = await db.query(query, [kode]);
  return rows.length > 0 ? rows[0] : null;
};

const generateKode = async () => {
  // Mengambil max dari 3 karakter pertama (angka)
  const query = `SELECT IFNULL(MAX(CAST(SUBSTR(sal_kode, 1, 3) AS UNSIGNED)), 0) AS max_val FROM tsales`;
  const [[row]] = await db.query(query);

  const nextNum = parseInt(row.max_val, 10) + 1;
  // Pad dengan 0 di depan hingga panjang 3 karakter
  return String(nextNum).padStart(3, "0");
};

const create = async (data, user) => {
  const kode = await generateKode();

  const query = `
    INSERT INTO tsales (
      sal_kode, sal_nama, sal_alamat, sal_kota, sal_telp, user_create, date_create
    ) VALUES (?, ?, ?, ?, ?, ?, NOW())
  `;

  await db.query(query, [
    kode,
    data.Nama,
    data.Alamat || "",
    data.Kota || "",
    data.Telp || "",
    user,
  ]);

  return kode;
};

const update = async (kode, data, user) => {
  const query = `
    UPDATE tsales SET 
      sal_nama = ?, 
      sal_alamat = ?, 
      sal_kota = ?, 
      sal_telp = ?, 
      user_modified = ?, 
      date_modified = NOW()
    WHERE sal_kode = ?
  `;

  await db.query(query, [
    data.Nama,
    data.Alamat || "",
    data.Kota || "",
    data.Telp || "",
    user,
    kode,
  ]);
};

const remove = async (kode) => {
  const query = `DELETE FROM tsales WHERE sal_kode = ?`;
  await db.query(query, [kode]);
};

module.exports = { getBrowse, getById, create, update, remove };
