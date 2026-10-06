const db = require("../../config/database");

// Normalisasi: huruf besar, buang semua selain huruf/angka.
const normalisasiNama = (s) =>
  String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

const cariNamaKembar = async (nama, excludeKode = "", conn = db) => {
  const norm = normalisasiNama(nama);
  if (!norm) return [];
  const [rows] = await conn.query(
    `SELECT cus_kode AS Kode, cus_nama AS Nama, cus_kota AS Kota,
            IF(cus_aktif = 0, 'AKTIF', 'PASIF') AS Status
     FROM tcustomer
     WHERE cus_iscabang = 0 AND cus_kode <> ?
       AND REGEXP_REPLACE(UPPER(cus_nama), '[^A-Z0-9]', '') = ?
     LIMIT 5`,
    [excludeKode, norm],
  );
  return rows;
};

const cariNamaMirip = async (nama, excludeKode = "", conn = db) => {
  const norm = normalisasiNama(nama);
  if (norm.length < 3) return [];
  const [rows] = await conn.query(
    `SELECT x.Kode, x.Nama, x.Kota, x.Status, (x.norm = ?) AS Sama
     FROM (
       SELECT cus_kode AS Kode, cus_nama AS Nama, cus_kota AS Kota,
              IF(cus_aktif = 0, 'AKTIF', 'PASIF') AS Status,
              REGEXP_REPLACE(UPPER(cus_nama), '[^A-Z0-9]', '') AS norm
       FROM tcustomer
       WHERE cus_iscabang = 0 AND cus_kode <> ?
     ) x
     WHERE x.norm LIKE CONCAT('%', ?, '%')
        OR (CHAR_LENGTH(x.norm) >= 5 AND ? LIKE CONCAT('%', x.norm, '%'))
     ORDER BY Sama DESC, x.Nama
     LIMIT 8`,
    [norm, excludeKode, norm, norm],
  );
  return rows.map((r) => ({ ...r, Sama: Number(r.Sama) === 1 }));
};

const errNamaKembar = (k) => {
  const err = new Error(
    `Nama customer sudah terdaftar: ${k.Kode} - ${k.Nama} (${k.Kota || "-"}, ${k.Status}).`,
  );
  err.status = 409;
  return err;
};

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
      IFNULL((
        SELECT SUM(p.debet) - SUM(IFNULL((
          SELECT SUM(d.kredit) FROM piutang_kredit_detail d
          INNER JOIN piutang_kredit_header h ON h.nomor = d.nomor
          WHERE d.nota = p.nota
        ), 0))
        FROM piutang_debet p
        WHERE p.customer = tcustomer.cus_kode AND p.flag = 0 AND p.is_writeoff = 0
      ), 0) AS Piutang,
      IF(cus_korporasi = 'Y', 'KORPORASI', 'PERORANGAN') AS Status, 
      cus_jenisusaha AS JenisUsaha,
      cus_npwp AS NPWP, 
      cus_kodei AS Induk, 
      cus_prioritas AS Prioritas,
      cus_plafon AS Plafon,
      cus_plafon_acc AS PlafonAcc, 
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
           b.Cus_kota AS kotai,
           IFNULL((
             SELECT SUM(p.debet) - SUM(IFNULL((
               SELECT SUM(d.kredit) FROM piutang_kredit_detail d
               INNER JOIN piutang_kredit_header h ON h.nomor = d.nomor
               WHERE d.nota = p.nota
             ), 0))
             FROM piutang_debet p
             WHERE p.customer = a.cus_kode AND p.flag = 0 AND p.is_writeoff = 0
           ), 0) AS cus_piutang_live
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

const generateKode = async (conn = db) => {
  // Logic dari Delphi: 'select ifnull(max(substr(cus_kode,1,5)),0) ...'
  // Delphi: Result:= RightStr(FloatToStr(ajumlah),5); (100001 + max_val -> ambil 5 char kanan)
  const query = `SELECT IFNULL(MAX(CAST(SUBSTR(cus_kode, 1, 5) AS UNSIGNED)), 0) AS max_val FROM tcustomer WHERE cus_iscabang = 0`;
  const [[row]] = await conn.query(query);

  const nextNum = parseInt(row.max_val, 10) + 1;
  // Pad dengan 0 di depan hingga panjang 5
  return String(nextNum).padStart(5, "0");
};

const insertCustomer = async (data, user, conn) => {
  const kode = await generateKode(conn);
  const plafon = Number(data.Plafon) || 0;

  // Tentukan status plafon dan aktif/pasif
  let plafonAcc = "";
  let aktif = 0; // 0 = aktif di DB
  let plafonTglMinta = null;
  let plafonUserMinta = "";

  if (plafon > 0 && plafon <= 20_000_000) {
    plafonAcc = "PENDING_MANAGER";
    aktif = 1; // pasif dulu
    plafonTglMinta = new Date();
    plafonUserMinta = user;
  } else if (plafon > 20_000_000) {
    plafonAcc = "PENDING_DIREKSI";
    aktif = 1; // pasif dulu
    plafonTglMinta = new Date();
    plafonUserMinta = user;
  }
  // plafon = 0 → tidak butuh approval, langsung aktif

  const query = `
    INSERT INTO tcustomer (
      cus_kode, cus_kodei, cus_nama, cus_alamat, cus_kota, cus_telp, cus_telp2, cus_fax, cus_cp, cus_email,
      cus_korporasi, cus_jenisusaha, cus_npwp, cus_nama_npwp, cus_alamat_npwp, cus_kota_npwp,
      cus_disc_persen, cus_top, cus_prioritas, cus_keramat, cus_spanduk, cus_garmen, cus_mmt,
      cus_perfect, cus_aktif,
      cus_plafon, cus_plafon_acc, cus_plafon_tgl_minta, cus_plafon_user_minta,
      user_create, date_create
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
  `;

  await conn.query(query, [
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
    aktif,
    plafon,
    plafonAcc,
    plafonTglMinta,
    plafonUserMinta,
    user,
  ]);

  return { kode, plafonAcc };
};

const create = async (data, user) => {
  const conn = await db.getConnection();
  try {
    const [[lock]] = await conn.query(
      `SELECT GET_LOCK('tcustomer_create', 10) AS got`,
    );
    if (Number(lock.got) !== 1) {
      throw new Error("Sistem sedang memproses customer lain, coba lagi.");
    }

    const kembar = await cariNamaKembar(data.Nama, "", conn);
    if (kembar.length) throw errNamaKembar(kembar[0]);

    return await insertCustomer(data, user, conn);
  } finally {
    await conn.query(`SELECT RELEASE_LOCK('tcustomer_create')`).catch(() => {});
    conn.release();
  }
};

const update = async (kode, data, user) => {
  const plafon = Number(data.Plafon) || 0;

  // Ambil data lama dulu
  const [[existing]] = await db.query(
    `SELECT cus_nama, cus_plafon, cus_plafon_acc, cus_aktif FROM tcustomer WHERE cus_kode = ?`,
    [kode],
  );

  if (normalisasiNama(existing?.cus_nama) !== normalisasiNama(data.Nama)) {
    const kembar = await cariNamaKembar(data.Nama, kode);
    if (kembar.length) throw errNamaKembar(kembar[0]);
  }

  const plafonLama = Number(existing?.cus_plafon) || 0;
  const plafonBerubah = plafon !== plafonLama;

  let plafonAcc = existing?.cus_plafon_acc || "";
  let aktifClause = "";
  let plafonFields = "";
  const extraParams = [];

  if (plafonBerubah && plafon > 0) {
    if (plafon <= 20_000_000) {
      plafonAcc = "PENDING_MANAGER";
    } else {
      plafonAcc = "PENDING_DIREKSI";
    }
    plafonFields = `
      cus_plafon = ?,
      cus_plafon_acc = ?,
      cus_plafon_tgl_minta = NOW(),
      cus_plafon_user_minta = ?,
      cus_plafon_tgl_acc = NULL,
      cus_plafon_user_acc = '',
      cus_aktif = 1,
    `;
    extraParams.push(plafon, plafonAcc, user);
  } else if (plafonBerubah && plafon === 0) {
    // Plafon dihapus → reset
    plafonFields = `
      cus_plafon = 0,
      cus_plafon_acc = '',
      cus_plafon_tgl_minta = NULL,
      cus_plafon_user_minta = '',
      cus_plafon_tgl_acc = NULL,
      cus_plafon_user_acc = '',
    `;
  } else {
    plafonFields = `cus_plafon = ?,`;
    extraParams.push(plafon);
  }

  const query = `
    UPDATE tcustomer SET
      cus_kodei = ?, cus_nama = ?, cus_alamat = ?, cus_kota = ?,
      cus_telp = ?, cus_telp2 = ?, cus_fax = ?, cus_cp = ?, cus_email = ?,
      cus_korporasi = ?, cus_jenisusaha = ?,
      cus_npwp = ?, cus_nama_npwp = ?, cus_alamat_npwp = ?, cus_kota_npwp = ?,
      cus_disc_persen = ?, cus_top = ?,
      cus_prioritas = ?, cus_keramat = ?, cus_spanduk = ?, cus_garmen = ?, cus_mmt = ?,
      cus_perfect = ?,
      ${plafonFields}
      user_modified = ?, date_modified = NOW()
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
    ...extraParams,
    user,
    kode,
  ]);

  return { kode, plafonAcc };
};

const remove = async (kode) => {
  // Note: Dalam production, sebaiknya tidak hard-delete customer yang sudah punya transaksi.
  // Tapi kita ikuti alur Delphi yang menggunakan DELETE murni.
  await db.query("DELETE FROM tcustomer WHERE cus_kode = ?", [kode]);
};

module.exports = {
  cariNamaKembar,
  cariNamaMirip,
  getBrowse,
  getById,
  getJenisUsahaLookup,
  create,
  update,
  remove,
};
