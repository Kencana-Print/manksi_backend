const db = require("../../config/database");

const getBrowse = async (filterKorporasi) => {
  // Filter status korporasi
  let korporasiClause = "";
  if (filterKorporasi === "Y" || filterKorporasi === "N") {
    korporasiClause = ` AND cus_korporasi = '${filterKorporasi}' `;
  }

  const query = `
    SELECT 
      cus_kode AS Kode, 
      cus_nama AS Nama, 
      cus_alamat AS Alamat, 
      cus_kota AS Kota, 
      cus_fax AS Fax, 
      cus_telp AS Telp, 
      cus_cp AS Contact, 
      cus_email AS Email, 
      cus_piutang AS Piutang,
      IF(cus_korporasi = 'Y', 'KORPORASI', 'PERORANGAN') AS Status, 
      cus_jenisusaha AS JenisUsaha,
      cus_npwp AS NPWP, 
      cus_kodei AS Induk, 
      cus_prioritas AS Prioritas, 
      IF(cus_aktif = 0, '', 'YA') AS Pasif
    FROM tcustomer 
    WHERE cus_iscabang = 0 ${korporasiClause}
    ORDER BY cus_nama ASC
  `;
  const [rows] = await db.query(query);
  return rows;
};

const getById = async (kode) => {
  const query = `
    SELECT a.*, 
           b.Cus_nama AS namai, 
           b.Cus_alamat AS alamati, 
           b.Cus_kota AS kotai
    FROM tcustomer a
    LEFT JOIN tcustomer b ON b.cus_kode = a.Cus_kodei
    WHERE a.cus_kode = ?
  `;
  const [rows] = await db.query(query, [kode]);
  return rows[0]; // Mengembalikan object data
};

const getJenisUsahaLookup = async () => {
  const [rows] = await db.query(
    "SELECT cju_jenis AS Jenis FROM tcustomer_jenisusaha ORDER BY cju_jenis",
  );
  return rows;
};

const generateKode = async () => {
  // Logic dari Delphi: 'select ifnull(max(substr(cus_kode,1,5)),0) ...'
  // Delphi: Result:= RightStr(FloatToStr(ajumlah),5); (100001 + max_val -> ambil 5 char kanan)
  const query = `SELECT IFNULL(MAX(CAST(SUBSTR(cus_kode, 1, 5) AS UNSIGNED)), 0) AS max_val FROM tcustomer WHERE cus_iscabang = 0`;
  const [[row]] = await db.query(query);

  const nextNum = parseInt(row.max_val, 10) + 1;
  // Pad dengan 0 di depan hingga panjang 5
  return String(nextNum).padStart(5, "0");
};

const create = async (data, user) => {
  const kode = await generateKode();

  const query = `
    INSERT INTO tcustomer (
      cus_kode, cus_kodei, cus_nama, cus_alamat, cus_kota, cus_telp, cus_telp2, cus_fax, cus_cp, cus_email, 
      cus_korporasi, cus_jenisusaha, cus_npwp, cus_nama_npwp, cus_alamat_npwp, cus_kota_npwp, 
      cus_disc_persen, cus_top, cus_prioritas, cus_keramat, cus_spanduk, cus_garmen, cus_mmt, 
      cus_perfect, user_create, date_create
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
  `;

  await db.query(query, [
    kode,
    data.KodeInduk || "",
    data.Nama,
    data.Alamat,
    data.Kota,
    data.Telp,
    data.Telp2 || "",
    data.Fax || "",
    data.Contact,
    data.Email || "",
    data.Korporasi,
    data.JenisUsaha,
    data.NpwpKode || "",
    data.NpwpNama || "",
    data.NpwpAlamat || "",
    data.NpwpKota || "",
    Number(data.DiscPersen) || 0,
    Number(data.Top) || 0,
    data.Prioritas || "N",
    data.Keramat || "N",
    data.Spanduk ? "Y" : "N",
    data.Garmen ? "Y" : "N",
    data.Mmt ? "Y" : "N",
    data.Perfect || "",
    user,
  ]);

  return kode;
};

const update = async (kode, data, user) => {
  const query = `
    UPDATE tcustomer SET 
      cus_kodei = ?, cus_nama = ?, cus_alamat = ?, cus_kota = ?, cus_telp = ?, cus_telp2 = ?, cus_fax = ?, cus_cp = ?, cus_email = ?, 
      cus_korporasi = ?, cus_jenisusaha = ?, cus_npwp = ?, cus_nama_npwp = ?, cus_alamat_npwp = ?, cus_kota_npwp = ?, 
      cus_disc_persen = ?, cus_top = ?, cus_prioritas = ?, cus_keramat = ?, cus_spanduk = ?, cus_garmen = ?, cus_mmt = ?, 
      cus_perfect = ?, user_modified = ?, date_modified = NOW()
    WHERE cus_kode = ?
  `;

  await db.query(query, [
    data.KodeInduk || "",
    data.Nama,
    data.Alamat,
    data.Kota,
    data.Telp,
    data.Telp2 || "",
    data.Fax || "",
    data.Contact,
    data.Email || "",
    data.Korporasi,
    data.JenisUsaha,
    data.NpwpKode || "",
    data.NpwpNama || "",
    data.NpwpAlamat || "",
    data.NpwpKota || "",
    Number(data.DiscPersen) || 0,
    Number(data.Top) || 0,
    data.Prioritas || "N",
    data.Keramat || "N",
    data.Spanduk ? "Y" : "N",
    data.Garmen ? "Y" : "N",
    data.Mmt ? "Y" : "N",
    data.Perfect || "",
    user,
    kode,
  ]);
};

const remove = async (kode) => {
  // Note: Dalam production, sebaiknya tidak hard-delete customer yang sudah punya transaksi.
  // Tapi kita ikuti alur Delphi yang menggunakan DELETE murni.
  await db.query("DELETE FROM tcustomer WHERE cus_kode = ?", [kode]);
};

module.exports = {
  getBrowse,
  getById,
  getJenisUsahaLookup,
  create,
  update,
  remove,
};
