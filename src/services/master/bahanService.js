const db = require("../../config/database");

// --- CAKUPAN BAHAN PER CABANG ---
// Spanduk = kode berawalan 'SB'; garmen = sisanya.
const CABANG_SPANDUK = ["P02", "P05"];
const CABANG_GARMEN = ["P01", "P04"];

const tipeAkses = (cabang) => {
  const c = String(cabang || "")
    .trim()
    .toUpperCase();
  if (CABANG_SPANDUK.includes(c)) return "SPANDUK";
  if (CABANG_GARMEN.includes(c)) return "GARMEN";
  return "SEMUA";
};

// Fragmen WHERE yang bisa dipakai ulang oleh lookup bahan di service lain.
const filterTipe = (cabang, kolom = "b.Bhn_kode") => {
  const akses = tipeAkses(cabang);
  if (akses === "SPANDUK") return ` AND LEFT(${kolom}, 2) = 'SB'`;
  if (akses === "GARMEN") return ` AND LEFT(${kolom}, 2) <> 'SB'`;
  return "";
};

const tipeDariKode = (kode) =>
  String(kode || "")
    .toUpperCase()
    .startsWith("SB")
    ? "SPANDUK"
    : "GARMEN";

const galat = (pesan, status) => {
  const e = new Error(pesan);
  e.status = status;
  return e;
};

const cekAkses = (cabang, kode) => {
  const akses = tipeAkses(cabang);
  if (akses !== "SEMUA" && akses !== tipeDariKode(kode)) {
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
     WHERE LEFT(Bhn_kode, 2) = 'SB'
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
         (Bhn_kode, Bhn_Name, Bhn_satuan, Bhn_jb_kode, bhn_konstruksi, bhn_panjang, bhn_lebar,
          bhn_ket, bhn_dead, bhn_hargabeli, bhn_buffer, user_create, date_create)
         VALUES (?, ?, ?, 'BB', ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
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

// --- BROWSE ---
const getBrowseBahan = async (cabang) => {
  const query = `
    SELECT 
      b.Bhn_kode AS Kode, b.bhn_name AS Nama, b.Bhn_satuan AS Satuan, 
      IF(LEFT(b.Bhn_kode, 2) = 'SB', 'SPANDUK', 'GARMEN') AS Tipe,
      IFNULL(w.bw_nama, '') AS Warna, IFNULL(g.bg_nama, '') AS Gramasi, IFNULL(s.bs_nama, '') AS Setting, 
      IFNULL(b.bhn_konstruksi, '') AS Konstruksi, b.bhn_panjang AS Panjang, b.bhn_lebar AS Lebar,
      IF(b.bhn_dead = 0, '', 'YA') AS DeadStock, b.bhn_buffer AS Buffer, 
      IFNULL(stok.total_stok, 0) AS Stok, 
      IF(b.bhn_buffer = 0, 0, IFNULL(stok.total_stok, 0) - b.bhn_buffer) AS Safety, 
      b.bhn_ket AS Keterangan
    FROM tbahan b
    LEFT JOIN tbahan_warna w ON w.bw_kode = MID(b.Bhn_kode, 3, 3) AND LEFT(b.Bhn_kode, 2) <> 'SB'
    LEFT JOIN tbahan_gramasi g ON g.bg_kode = MID(b.Bhn_kode, 6, 2) AND LEFT(b.Bhn_kode, 2) <> 'SB'
    LEFT JOIN tbahan_setting s ON s.bs_kode = SUBSTRING(b.Bhn_kode, 8, 2) AND LEFT(b.Bhn_kode, 2) <> 'SB'
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
  cekAkses(cabang, kode);
  const query = `
    SELECT 
      b.Bhn_kode,
      b.Bhn_Name AS Bhn_name,
      b.Bhn_satuan,
      b.Bhn_jb_kode,
      b.Bhn_stok,
      b.bhn_buffer AS Bhn_buffer,
      b.Bhn_hargabeli,
      b.Bhn_avgcost,
      b.bhn_dead AS Bhn_dead,
      b.bhn_ket AS Bhn_ket,
      b.bhn_GRAMASI AS Bhn_gramasi,
      b.bhn_setting AS Bhn_setting,
      b.bhn_aktif AS Bhn_aktif,
      IF(LEFT(b.Bhn_kode, 2) = 'SB', 'SPANDUK', 'GARMEN') AS Tipe,
      b.bhn_konstruksi AS Bhn_konstruksi,
      b.bhn_panjang AS Bhn_panjang,
      b.bhn_lebar AS Bhn_lebar,
      LEFT(b.Bhn_kode, 2) AS kdJenis,
      MID(b.Bhn_kode, 3, 3) AS kdWarna,
      MID(b.Bhn_kode, 6, 2) AS kdGramasi,
      SUBSTRING(b.Bhn_kode, 8, 2) AS kdSetting,
      IFNULL(j.bj_nama, "") as nmJenis, IFNULL(w.bw_nama, "") as nmWarna, 
      IFNULL(g.bg_nama, "") as nmGramasi, IFNULL(s.bs_nama, "") as nmSetting,
      IFNULL(p.project, "REGULER") as project
    FROM tbahan b
    LEFT JOIN tbahan_jenis j ON j.bj_kode = LEFT(b.Bhn_kode, 2)
    LEFT JOIN tbahan_warna w ON w.bw_kode = MID(b.Bhn_kode, 3, 3) AND LEFT(b.Bhn_kode, 2) <> 'SB'
    LEFT JOIN tbahan_gramasi g ON g.bg_kode = MID(b.Bhn_kode, 6, 2) AND LEFT(b.Bhn_kode, 2) <> 'SB'
    LEFT JOIN tbahan_setting s ON s.bs_kode = SUBSTRING(b.Bhn_kode, 8, 2) AND LEFT(b.Bhn_kode, 2) <> 'SB'
    LEFT JOIN tbahan_project p ON p.kode = MID(b.Bhn_kode, 10, 1) AND LEFT(b.Bhn_kode, 2) <> 'SB'
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
    akses !== "SEMUA" ? akses : data.Tipe === "SPANDUK" ? "SPANDUK" : "GARMEN";

  if (tipe === "SPANDUK") return createSpanduk(data, user);

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
  const [existing] = await db.query(
    "SELECT bhn_kode FROM tbahan WHERE bhn_kode = ?",
    [generatedKode],
  );
  if (existing.length > 0) {
    throw galat(
      `Master bahan dengan kode ${generatedKode} sudah ada di database.`,
      409,
    );
  }

  const query = `
    INSERT INTO tbahan 
    (bhn_kode, bhn_name, bhn_satuan, bhn_setting, bhn_gramasi, bhn_ket, bhn_dead, bhn_hargabeli, bhn_buffer, user_create, date_create)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
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
  cekAkses(cabang, kode);

  if (tipeDariKode(kode) === "SPANDUK") {
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
  cekAkses(cabang, kode);
  // Soft delete ala Delphi (bhn_aktif = 1)
  await db.query("UPDATE tbahan SET bhn_aktif = 1 WHERE bhn_kode = ?", [kode]);
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
        akses !== "SEMUA" ? akses : tipe === "SPANDUK" ? "SPANDUK" : "GARMEN";
      query =
        efektif === "SPANDUK"
          ? "SELECT Satuan AS Kode, Satuan AS Nama FROM tbahan_satuan WHERE Satuan IN ('YARD','MTR')"
          : "SELECT Satuan AS Kode, Satuan AS Nama FROM tbahan_satuan WHERE Satuan <> 'YARD'";
      break;
    }
    default:
      return [];
  }
  const [rows] = await db.query(query);
  return rows;
};

module.exports = {
  tipeAkses,
  filterTipe,
  getBrowseBahan,
  getBahanById,
  createBahan,
  updateBahan,
  deleteBahan,
  getLookups,
};
