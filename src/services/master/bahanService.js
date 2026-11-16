const db = require("../../config/database");

// --- CAKUPAN BAHAN PER CABANG ---
// Spanduk = P02, Garmen = P01/P04, MMT = P05
const CABANG_SPANDUK = ["P02"];
const CABANG_GARMEN = ["P01", "P04"];
const CABANG_MMT = ["P05"];

const tipeAkses = (cabang) => {
  const c = String(cabang || "")
    .trim()
    .toUpperCase();
  if (CABANG_SPANDUK.includes(c)) return "SPANDUK";
  if (CABANG_GARMEN.includes(c)) return "GARMEN";
  if (CABANG_MMT.includes(c)) return "MMT";
  return "SEMUA";
};

// Fragmen WHERE yang bisa dipakai ulang oleh lookup bahan di service lain.
const filterTipe = (cabang, kolom = "b.bhn_divisi") => {
  const akses = tipeAkses(cabang);
  if (akses === "SPANDUK") {
    return kolom === "b.bhn_divisi"
      ? " AND b.bhn_divisi = 'SPANDUK'"
      : ` AND LEFT(${kolom}, 2) = 'SB'`;
  }
  if (akses === "GARMEN") {
    return kolom === "b.bhn_divisi"
      ? " AND b.bhn_divisi = 'GARMEN'"
      : ` AND LEFT(${kolom}, 2) <> 'SB'`;
  }
  if (akses === "MMT") {
    return " AND b.bhn_divisi = 'MMT'";
  }
  return "";
};

const tipeDariKode = async (kode) => {
  const [rows] = await db.query(
    "SELECT bhn_divisi FROM tbahan WHERE Bhn_kode = ? LIMIT 1",
    [kode],
  );
  if (rows.length && rows[0].bhn_divisi) {
    return rows[0].bhn_divisi.toUpperCase();
  }
  return String(kode || "")
    .toUpperCase()
    .startsWith("SB")
    ? "SPANDUK"
    : "GARMEN";
};

const galat = (pesan, status) => {
  const e = new Error(pesan);
  e.status = status;
  return e;
};

const cekAkses = async (cabang, kode) => {
  const akses = tipeAkses(cabang);
  if (akses === "SEMUA") return;
  const tipe = await tipeDariKode(kode);
  if (akses !== tipe) {
    throw galat("Bahan ini di luar cakupan cabang Anda.", 403);
  }
};

// --- SPANDUK: validasi, duplikat, kode ---
const angka = (v) => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

const validasiSpanduk = (data) => {
  const nama = String(data.Bhn_name || "")
    .trim()
    .toUpperCase();
  const konstruksi = String(data.Bhn_konstruksi || "")
    .trim()
    .toUpperCase();
  const satuan = String(data.Bhn_satuan || "")
    .trim()
    .toUpperCase();
  const panjang = angka(data.Bhn_panjang);
  const lebar = angka(data.Bhn_lebar);

  if (!nama) throw galat("Nama bahan wajib diisi.", 400);
  if (nama.length > 200) throw galat("Nama bahan maksimal 200 karakter.", 400);
  if (konstruksi.length > 20)
    throw galat("Konstruksi maksimal 20 karakter.", 400);
  if (!["YARD", "MTR"].includes(satuan))
    throw galat("Satuan bahan spanduk harus YARD atau MTR.", 400);
  if (lebar === null || Number.isNaN(lebar) || lebar <= 0)
    throw galat("Lebar wajib diisi dan harus lebih dari 0.", 400);
  if (Number.isNaN(panjang) || (panjang !== null && panjang <= 0))
    throw galat("Panjang harus lebih dari 0 (atau kosongkan).", 400);

  return { nama, konstruksi, satuan, panjang, lebar };
};

// Nama + konstruksi + panjang + lebar sama persis = bahan yang sama.
const cekDuplikatSpanduk = async (v, kodeSendiri) => {
  const [rows] = await db.query(
    `SELECT Bhn_kode FROM tbahan
     WHERE bhn_divisi = 'SPANDUK'
       AND UPPER(TRIM(Bhn_Name)) = ?
       AND UPPER(TRIM(bhn_konstruksi)) = ?
       AND bhn_panjang <=> ? AND bhn_lebar <=> ?
       AND Bhn_kode <> ?
     LIMIT 1`,
    [v.nama, v.konstruksi, v.panjang, v.lebar, kodeSendiri || ""],
  );
  if (rows.length > 0) {
    throw galat(
      `Bahan dengan nama, konstruksi, panjang, dan lebar yang sama sudah ada (${rows[0].Bhn_kode}).`,
      409,
    );
  }
};

const buatKodeSpanduk = async () => {
  const [[row]] = await db.query(
    `SELECT IFNULL(MAX(CAST(SUBSTRING(Bhn_kode, 3) AS UNSIGNED)), 0) AS n
     FROM tbahan WHERE Bhn_kode REGEXP '^SB[0-9]{7}$'`,
  );
  return "SB" + String(Number(row.n) + 1).padStart(7, "0");
};

const createSpanduk = async (data, user) => {
  const v = validasiSpanduk(data);
  await cekDuplikatSpanduk(v, "");

  // PK menjaga dari kode kembar bila dua user simpan bersamaan: ulangi.
  for (let i = 0; i < 3; i++) {
    const kode = await buatKodeSpanduk();
    try {
      await db.query(
        `INSERT INTO tbahan
         (Bhn_kode, Bhn_Name, bhn_divisi, Bhn_satuan, Bhn_jb_kode, bhn_konstruksi, bhn_panjang, bhn_lebar,
          bhn_ket, bhn_dead, bhn_hargabeli, bhn_buffer, user_create, date_create)
         VALUES (?, ?, 'SPANDUK', ?, 'BB', ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          kode,
          v.nama,
          v.satuan,
          v.konstruksi,
          v.panjang,
          v.lebar,
          data.Bhn_ket || "",
          data.Bhn_dead ?? 0,
          Number(data.Bhn_hargabeli) || 0,
          Number(data.Bhn_buffer) || 0,
          user,
        ],
      );
      return kode;
    } catch (err) {
      if (err.code !== "ER_DUP_ENTRY") throw err;
    }
  }
  throw galat("Gagal membuat kode bahan, silakan simpan ulang.", 409);
};

// --- MMT: Validasi, Cek Duplikat Kode, Create, Update ---
const checkKodeBahanExists = async (kode, excludeKode = "") => {
  const k = String(kode || "").trim();
  if (!k) {
    return { exists: false, valid: false, message: "Kode bahan wajib diisi." };
  }
  if (k.length < 3) {
    return { exists: false, valid: false, message: "Kode bahan minimal 3 karakter." };
  }

  // 1. Cek tbahan
  const [rowsBahan] = await db.query(
    "SELECT Bhn_kode, Bhn_Name, bhn_divisi FROM tbahan WHERE UPPER(TRIM(Bhn_kode)) = UPPER(?) AND Bhn_kode <> ? LIMIT 1",
    [k, excludeKode || ""],
  );
  if (rowsBahan.length > 0) {
    const b = rowsBahan[0];
    return {
      exists: true,
      valid: false,
      message: `Kode bahan "${k}" sudah digunakan di database (${b.bhn_divisi}: ${b.Bhn_Name}). Silakan gunakan kode lain.`,
    };
  }

  // 2. Cek tbarang_mmt (jika ada data lama di tabel tbarang_mmt)
  try {
    const [rowsMmt] = await db.query(
      "SELECT brg_kode, brg_nama FROM tbarang_mmt WHERE UPPER(TRIM(brg_kode)) = UPPER(?) AND brg_kode <> ? LIMIT 1",
      [k, excludeKode || ""],
    );
    if (rowsMmt.length > 0) {
      return {
        exists: true,
        valid: false,
        message: `Kode bahan "${k}" sudah digunakan di database MMT (${rowsMmt[0].brg_nama}). Silakan gunakan kode lain.`,
      };
    }
  } catch (_e) {
    // Abaikan jika tbarang_mmt adalah view atau tidak ada
  }

  return { exists: false, valid: true, message: "Kode bahan tersedia." };
};

const createMmt = async (data, user) => {
  const kode = String(data.Bhn_kode || "").trim().toUpperCase();
  const nama = String(data.Bhn_name || "").trim().toUpperCase();

  if (!kode || kode.length < 3) {
    throw galat("Kode bahan MMT minimal 3 karakter.", 400);
  }
  if (!nama) {
    throw galat("Nama bahan wajib diisi.", 400);
  }

  // Cek duplikasi kode
  const check = await checkKodeBahanExists(kode);
  if (check.exists) {
    throw galat(check.message, 409);
  }

  const satuan = String(data.Bhn_satuan || "ROLL").trim().toUpperCase();
  const jenis = String(data.Bhn_jb_kode || data.Jenis || "BB").trim();
  const ktgKode = data.bhn_ktg_kode || data.KtgKode || null;
  const gdgDefault = data.bhn_gdg_default || data.GdgDefault || "WH-16";
  const supKode = data.bhn_sup_kode || data.SupKode || null;
  const panjang = Number(data.Bhn_panjang) || 0;
  const lebar = Number(data.Bhn_lebar) || 0;
  const status = ["F", "S", "N"].includes(String(data.bhn_status || data.Status || "").toUpperCase())
    ? String(data.bhn_status || data.Status).toUpperCase()
    : "S";
  const hrgBeli = Number(data.Bhn_hargabeli) || 0;
  const hrgJual = Number(data.bhn_hrgjual || data.HrgJual) || 0;
  const buffer = Number(data.Bhn_buffer) || 0;
  const ket = String(data.Bhn_ket || "").trim();
  const isAktif = data.isAktif !== undefined ? (Number(data.isAktif) ? 0 : 1) : 0; // 0=aktif di tbahan
  const isStok = data.isStok !== undefined ? (Number(data.isStok) ? 1 : 0) : 1;
  const isExpired = data.isExpired !== undefined ? (Number(data.isExpired) ? 1 : 0) : 0;

  await db.query(
    `INSERT INTO tbahan (
       Bhn_kode, Bhn_Name, bhn_divisi, bhn_ktg_kode, bhn_gdg_default, bhn_sup_kode,
       Bhn_satuan, Bhn_jb_kode, bhn_panjang, bhn_lebar, bhn_status,
       Bhn_hargabeli, bhn_hrgjual, bhn_buffer, bhn_ket,
       bhn_aktif, bhn_isstok, bhn_isexpired, user_create, date_create
     ) VALUES (?, ?, 'MMT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      kode,
      nama,
      ktgKode,
      gdgDefault,
      supKode,
      satuan,
      jenis,
      panjang,
      lebar,
      status,
      hrgBeli,
      hrgJual,
      buffer,
      ket,
      isAktif,
      isStok,
      isExpired,
      user,
    ],
  );

  // Sinkronkan ke tbarang_mmt jika tbarang_mmt masih tabel fisik
  try {
    await db.query(
      `INSERT INTO tbarang_mmt (
         brg_kode, brg_nama, brg_satuan, brg_panjang, brg_lebar,
         brg_stok, brg_ktg_kode, brg_gdg_default, brg_sup_kode,
         brg_hrgjual, brg_hrgbeli, brg_isaktif, brg_isstok, brg_isexpired,
         date_create, user_create, brg_status, brg_jenis, brg_divisi
       ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, 5)
       ON DUPLICATE KEY UPDATE brg_nama = VALUES(brg_nama)`,
      [
        kode,
        nama,
        satuan,
        panjang,
        lebar,
        ktgKode,
        gdgDefault,
        supKode,
        hrgJual,
        hrgBeli,
        isAktif === 0 ? 1 : 0,
        isStok,
        isExpired,
        user,
        status,
        jenis,
      ],
    );
  } catch (_e) {
    // Abaikan jika tbarang_mmt view atau error
  }

  return kode;
};

// --- BROWSE ---
const getBrowseBahan = async (cabang) => {
  const query = `
    SELECT 
      b.Bhn_kode AS Kode, b.bhn_name AS Nama, b.Bhn_satuan AS Satuan, 
      COALESCE(NULLIF(b.bhn_divisi, ''), IF(LEFT(b.Bhn_kode, 2) = 'SB', 'SPANDUK', 'GARMEN')) AS Tipe,
      b.bhn_divisi AS Divisi,
      IFNULL(w.bw_nama, '') AS Warna, IFNULL(g.bg_nama, '') AS Gramasi, IFNULL(s.bs_nama, '') AS Setting, 
      IFNULL(b.bhn_konstruksi, '') AS Konstruksi, b.bhn_panjang AS Panjang, b.bhn_lebar AS Lebar,
      IF(b.bhn_dead = 0, '', 'YA') AS DeadStock, b.bhn_buffer AS Buffer, 
      IFNULL(stok.total_stok, 0) AS Stok, 
      IF(b.bhn_buffer = 0, 0, IFNULL(stok.total_stok, 0) - b.bhn_buffer) AS Safety, 
      b.bhn_ket AS Keterangan,
      b.bhn_status AS Status,
      IFNULL(k.ktg_nama, '') AS Kategori,
      IFNULL(sup.sup_nama, '') AS Supplier,
      IFNULL(gdg.gdg_nama, '') AS GudangDefault
    FROM tbahan b
    LEFT JOIN tbahan_warna w ON w.bw_kode = MID(b.Bhn_kode, 3, 3) AND LEFT(b.Bhn_kode, 2) <> 'SB' AND b.bhn_divisi = 'GARMEN'
    LEFT JOIN tbahan_gramasi g ON g.bg_kode = MID(b.Bhn_kode, 6, 2) AND LEFT(b.Bhn_kode, 2) <> 'SB' AND b.bhn_divisi = 'GARMEN'
    LEFT JOIN tbahan_setting s ON s.bs_kode = SUBSTRING(b.Bhn_kode, 8, 2) AND LEFT(b.Bhn_kode, 2) <> 'SB' AND b.bhn_divisi = 'GARMEN'
    LEFT JOIN tkategori k ON k.ktg_kode = b.bhn_ktg_kode
    LEFT JOIN tsupplier sup ON sup.sup_kode = b.bhn_sup_kode
    LEFT JOIN tgudang gdg ON gdg.gdg_kode = b.bhn_gdg_default
    LEFT JOIN (
      SELECT mst_brg_kode, SUM(mst_stok_in - mst_stok_out) AS total_stok 
      FROM tmasterstok_bahan WHERE mst_aktif = 'Y' GROUP BY mst_brg_kode
    ) stok ON stok.mst_brg_kode = b.bhn_kode
    WHERE b.bhn_aktif = 0 AND LEFT(b.Bhn_kode, 2) <> 'LL'${filterTipe(cabang)}
    ORDER BY b.Bhn_kode ASC
  `;
  const [rows] = await db.query(query);
  return rows;
};

const getBahanById = async (kode, cabang) => {
  await cekAkses(cabang, kode);
  const query = `
    SELECT 
      b.Bhn_kode,
      b.Bhn_Name AS Bhn_name,
      b.Bhn_satuan,
      b.Bhn_jb_kode,
      b.Bhn_stok,
      b.bhn_buffer AS Bhn_buffer,
      b.Bhn_hargabeli,
      b.bhn_hrgjual AS Bhn_hrgjual,
      b.Bhn_avgcost,
      b.bhn_dead AS Bhn_dead,
      b.bhn_ket AS Bhn_ket,
      b.bhn_GRAMASI AS Bhn_gramasi,
      b.bhn_setting AS Bhn_setting,
      b.bhn_aktif AS Bhn_aktif,
      IF(b.bhn_aktif = 0, 1, 0) AS isAktif,
      b.bhn_isstok AS isStok,
      b.bhn_isexpired AS isExpired,
      b.bhn_status AS Bhn_status,
      b.bhn_ktg_kode,
      b.bhn_gdg_default,
      b.bhn_sup_kode,
      COALESCE(NULLIF(b.bhn_divisi, ''), IF(LEFT(b.Bhn_kode, 2) = 'SB', 'SPANDUK', 'GARMEN')) AS Tipe,
      b.bhn_divisi AS Divisi,
      b.bhn_konstruksi AS Bhn_konstruksi,
      b.bhn_panjang AS Bhn_panjang,
      b.bhn_lebar AS Bhn_lebar,
      LEFT(b.Bhn_kode, 2) AS kdJenis,
      MID(b.Bhn_kode, 3, 3) AS kdWarna,
      MID(b.Bhn_kode, 6, 2) AS kdGramasi,
      SUBSTRING(b.Bhn_kode, 8, 2) AS kdSetting,
      IFNULL(j.bj_nama, "") as nmJenis, IFNULL(w.bw_nama, "") as nmWarna, 
      IFNULL(g.bg_nama, "") as nmGramasi, IFNULL(s.bs_nama, "") as nmSetting,
      IFNULL(p.project, "REGULER") as project,
      IFNULL(k.ktg_nama, "") as KategoriNama,
      IFNULL(sup.sup_nama, "") as SupplierNama,
      IFNULL(gdg.gdg_nama, "") as GudangNama,
      IFNULL(jb.jb_nama, "") as JenisNama
    FROM tbahan b
    LEFT JOIN tbahan_jenis j ON j.bj_kode = LEFT(b.Bhn_kode, 2)
    LEFT JOIN tbahan_warna w ON w.bw_kode = MID(b.Bhn_kode, 3, 3) AND LEFT(b.Bhn_kode, 2) <> 'SB'
    LEFT JOIN tbahan_gramasi g ON g.bg_kode = MID(b.Bhn_kode, 6, 2) AND LEFT(b.Bhn_kode, 2) <> 'SB'
    LEFT JOIN tbahan_setting s ON s.bs_kode = SUBSTRING(b.Bhn_kode, 8, 2) AND LEFT(b.Bhn_kode, 2) <> 'SB'
    LEFT JOIN tbahan_project p ON p.kode = MID(b.Bhn_kode, 10, 1) AND LEFT(b.Bhn_kode, 2) <> 'SB'
    LEFT JOIN tkategori k ON k.ktg_kode = b.bhn_ktg_kode
    LEFT JOIN tsupplier sup ON sup.sup_kode = b.bhn_sup_kode
    LEFT JOIN tgudang gdg ON gdg.gdg_kode = b.bhn_gdg_default
    LEFT JOIN tjenisbarang jb ON jb.jb_kode = b.Bhn_jb_kode
    WHERE b.Bhn_kode = ?
  `;
  const [rows] = await db.query(query, [kode]);
  return rows[0];
};

// --- FORM ---
const createBahan = async (data, user, cabang) => {
  const akses = tipeAkses(cabang);
  // Cabang terbatas: tipe ditentukan server, kiriman klien diabaikan.
  const tipe =
    akses !== "SEMUA"
      ? akses
      : data.Tipe === "SPANDUK"
        ? "SPANDUK"
        : data.Tipe === "MMT"
          ? "MMT"
          : "GARMEN";

  if (tipe === "SPANDUK") return createSpanduk(data, user);
  if (tipe === "MMT") return createMmt(data, user);

  if (String(data.kdJenis || "").toUpperCase() === "SB") {
    throw galat("Jenis SB khusus bahan spanduk.", 400);
  }

  // Logic Penjahitan Kode (Delphi: edtkdJenis+edtkdwarna...)
  const ckdProject =
    data.project === "REGULER" ? "" : data.project.substring(0, 1);
  const generatedKode = (
    data.kdJenis +
    data.kdWarna +
    data.kdGramasi +
    data.kdSetting +
    ckdProject
  ).toUpperCase();

  // --- CEK DUPLIKAT ---
  const check = await checkKodeBahanExists(generatedKode);
  if (check.exists) {
    throw galat(
      `Master bahan dengan kode ${generatedKode} sudah ada di database.`,
      409,
    );
  }

  const query = `
    INSERT INTO tbahan 
    (bhn_kode, bhn_name, bhn_divisi, bhn_satuan, bhn_setting, bhn_gramasi, bhn_ket, bhn_dead, bhn_hargabeli, bhn_buffer, user_create, date_create)
    VALUES (?, ?, 'GARMEN', ?, ?, ?, ?, ?, ?, ?, ?, NOW())
  `;
  await db.query(query, [
    generatedKode,
    data.Bhn_name || "",
    data.Bhn_satuan || "",
    data.nmSetting || "",
    data.nmGramasi || "",
    data.Bhn_ket || "",
    data.Bhn_dead ?? 0,
    Number(data.Bhn_hargabeli) || 0,
    Number(data.Bhn_buffer) || 0,
    user,
  ]);
  return generatedKode;
};

const updateBahan = async (kode, data, user, cabang) => {
  await cekAkses(cabang, kode);
  const tipe = await tipeDariKode(kode);

  if (tipe === "SPANDUK") {
    const v = validasiSpanduk(data);
    await cekDuplikatSpanduk(v, kode);
    await db.query(
      `UPDATE tbahan SET 
         Bhn_Name = ?, Bhn_satuan = ?, bhn_konstruksi = ?, bhn_panjang = ?, bhn_lebar = ?,
         bhn_ket = ?, bhn_dead = ?, bhn_hargabeli = ?, bhn_buffer = ?,
         user_modified = ?, date_modified = NOW()
       WHERE Bhn_kode = ?`,
      [
        v.nama,
        v.satuan,
        v.konstruksi,
        v.panjang,
        v.lebar,
        data.Bhn_ket || "",
        data.Bhn_dead ?? 0,
        Number(data.Bhn_hargabeli) || 0,
        Number(data.Bhn_buffer) || 0,
        user,
        kode,
      ],
    );
    return;
  }

  if (tipe === "MMT" || data.Tipe === "MMT" || data.bhn_divisi === "MMT") {
    const nama = String(data.Bhn_name || "").trim().toUpperCase();
    if (!nama) throw galat("Nama bahan wajib diisi.", 400);

    const satuan = String(data.Bhn_satuan || "ROLL").trim().toUpperCase();
    const jenis = String(data.Bhn_jb_kode || data.Jenis || "BB").trim();
    const ktgKode = data.bhn_ktg_kode || data.KtgKode || null;
    const gdgDefault = data.bhn_gdg_default || data.GdgDefault || "WH-16";
    const supKode = data.bhn_sup_kode || data.SupKode || null;
    const panjang = Number(data.Bhn_panjang) || 0;
    const lebar = Number(data.Bhn_lebar) || 0;
    const status = ["F", "S", "N"].includes(String(data.bhn_status || data.Status || "").toUpperCase())
      ? String(data.bhn_status || data.Status).toUpperCase()
      : "S";
    const hrgBeli = Number(data.Bhn_hargabeli) || 0;
    const hrgJual = Number(data.bhn_hrgjual || data.HrgJual) || 0;
    const buffer = Number(data.Bhn_buffer) || 0;
    const ket = String(data.Bhn_ket || "").trim();
    const isAktif = data.isAktif !== undefined ? (Number(data.isAktif) ? 0 : 1) : (data.bhn_aktif !== undefined ? Number(data.bhn_aktif) : 0);
    const isStok = data.isStok !== undefined ? (Number(data.isStok) ? 1 : 0) : 1;
    const isExpired = data.isExpired !== undefined ? (Number(data.isExpired) ? 1 : 0) : 0;

    await db.query(
      `UPDATE tbahan SET
         Bhn_Name = ?, Bhn_satuan = ?, bhn_ktg_kode = ?, bhn_gdg_default = ?, bhn_sup_kode = ?,
         Bhn_jb_kode = ?, bhn_panjang = ?, bhn_lebar = ?, bhn_status = ?,
         Bhn_hargabeli = ?, bhn_hrgjual = ?, bhn_buffer = ?, bhn_ket = ?,
         bhn_aktif = ?, bhn_isstok = ?, bhn_isexpired = ?,
         user_modified = ?, date_modified = NOW()
       WHERE Bhn_kode = ?`,
      [
        nama,
        satuan,
        ktgKode,
        gdgDefault,
        supKode,
        jenis,
        panjang,
        lebar,
        status,
        hrgBeli,
        hrgJual,
        buffer,
        ket,
        isAktif,
        isStok,
        isExpired,
        user,
        kode,
      ],
    );

    try {
      await db.query(
        `UPDATE tbarang_mmt SET
           brg_nama = ?, brg_satuan = ?, brg_ktg_kode = ?, brg_gdg_default = ?, brg_sup_kode = ?,
           brg_jenis = ?, brg_panjang = ?, brg_lebar = ?, brg_status = ?,
           brg_hrgbeli = ?, brg_hrgjual = ?, brg_isaktif = ?, brg_isstok = ?, brg_isexpired = ?,
           user_modified = ?, date_modified = NOW()
         WHERE brg_kode = ?`,
        [
          nama,
          satuan,
          ktgKode,
          gdgDefault,
          supKode,
          jenis,
          panjang,
          lebar,
          status,
          hrgBeli,
          hrgJual,
          isAktif === 0 ? 1 : 0,
          isStok,
          isExpired,
          user,
          kode,
        ],
      );
    } catch (_e) {}

    return;
  }

  const query = `
    UPDATE tbahan SET 
      bhn_name = ?, bhn_satuan = ?, bhn_ket = ?, bhn_dead = ?, 
      bhn_hargabeli = ?, bhn_buffer = ?, user_modified = ?, date_modified = NOW()
    WHERE bhn_kode = ?
  `;
  await db.query(query, [
    data.Bhn_name || "",
    data.Bhn_satuan || "",
    data.Bhn_ket || "",
    data.Bhn_dead ?? 0,
    Number(data.Bhn_hargabeli) || 0,
    Number(data.Bhn_buffer) || 0,
    user,
    kode,
  ]);
};

const deleteBahan = async (kode, cabang) => {
  await cekAkses(cabang, kode);
  // Soft delete ala Delphi (bhn_aktif = 1)
  await db.query("UPDATE tbahan SET bhn_aktif = 1 WHERE bhn_kode = ?", [kode]);
  try {
    await db.query("UPDATE tbarang_mmt SET brg_isaktif = 0 WHERE brg_kode = ?", [kode]);
  } catch (_e) {}
};

// --- LOOKUP QUERIES ---
const getLookups = async (category, cabang, tipe) => {
  let query = "";
  switch (category) {
    case "tipe": {
      const akses = tipeAkses(cabang);
      const semua = [
        { Kode: "GARMEN", Nama: "Garmen" },
        { Kode: "SPANDUK", Nama: "Spanduk" },
        { Kode: "MMT", Nama: "MMT" },
      ];
      return akses === "SEMUA" ? semua : semua.filter((t) => t.Kode === akses);
    }
    case "jenis":
      query =
        "SELECT bj_kode AS Kode, bj_nama AS Nama FROM tbahan_jenis WHERE bj_kode <> 'SB' ORDER BY bj_kode";
      break;
    case "warna":
      query =
        "SELECT bw_kode AS Kode, bw_nama AS Nama FROM tbahan_warna ORDER BY bw_kode";
      break;
    case "gramasi":
      query =
        "SELECT bg_kode AS Kode, bg_nama AS Nama FROM tbahan_gramasi ORDER BY bg_kode";
      break;
    case "setting":
      query =
        "SELECT bs_kode AS Kode, bs_nama AS Nama FROM tbahan_setting ORDER BY bs_kode";
      break;
    case "project":
      // Ambil 'kode' untuk identitas jahit Bhn_kode, 'project' untuk label di dropdown
      query =
        "SELECT kode AS Kode, project AS Nama FROM tbahan_project ORDER BY kode";
      break;
    case "satuan": {
      const akses = tipeAkses(cabang);
      const efektif =
        akses !== "SEMUA" ? akses : tipe;
      if (efektif === "SPANDUK") {
        return [
          { Kode: "YARD", Nama: "YARD" },
          { Kode: "MTR", Nama: "MTR" },
        ];
      }
      if (efektif === "MMT") {
        const list = [
          "ROLL",
          "MTR",
          "M",
          "Y",
          "PCS",
          "PACK",
          "BOTOL",
          "MILILITER",
          "BOX",
        ];
        return list.map((s) => ({ Kode: s, Nama: s }));
      }
      query =
        "SELECT Satuan AS Kode, Satuan AS Nama FROM tbahan_satuan WHERE Satuan <> 'YARD' ORDER BY Satuan";
      break;
    }
    case "kategori":
      query =
        "SELECT ktg_kode AS Kode, ktg_nama AS Nama FROM tkategori WHERE LENGTH(ktg_kode) > 0 ORDER BY ktg_nama";
      break;
    case "gudang":
      query =
        "SELECT gdg_kode AS Kode, gdg_nama AS Nama FROM tgudang ORDER BY gdg_nama";
      break;
    case "supplier":
      query =
        "SELECT sup_kode AS Kode, sup_nama AS Nama FROM tsupplier ORDER BY sup_nama";
      break;
    case "jenis_mmt":
      query =
        "SELECT jb_kode AS Kode, jb_nama AS Nama FROM tjenisbarang ORDER BY jb_nama";
      break;
    default:
      return [];
  }
  const [rows] = await db.query(query);
  return rows;
};

module.exports = {
  tipeAkses,
  filterTipe,
  checkKodeBahanExists,
  getBrowseBahan,
  getBahanById,
  createBahan,
  updateBahan,
  deleteBahan,
  getLookups,
};
