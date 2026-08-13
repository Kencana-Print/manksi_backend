const db = require("../../config/database");

const getBrowseBahan = async () => {
  const query = `
    SELECT 
      b.Bhn_kode AS Kode, b.bhn_name AS Nama, b.Bhn_satuan AS Satuan, 
      IFNULL(w.bw_nama, '') AS Warna, IFNULL(g.bg_nama, '') AS Gramasi, IFNULL(s.bs_nama, '') AS Setting, 
      IF(b.bhn_dead = 0, '', 'YA') AS DeadStock, b.bhn_buffer AS Buffer, 
      IFNULL(stok.total_stok, 0) AS Stok, 
      IF(b.bhn_buffer = 0, 0, IFNULL(stok.total_stok, 0) - b.bhn_buffer) AS Safety, 
      b.bhn_ket AS Keterangan
    FROM tbahan b
    LEFT JOIN tbahan_warna w ON w.bw_kode = MID(b.Bhn_kode, 3, 3)
    LEFT JOIN tbahan_gramasi g ON g.bg_kode = MID(b.Bhn_kode, 6, 2)
    LEFT JOIN tbahan_setting s ON s.bs_kode = SUBSTRING(b.Bhn_kode, 8, 2)
    LEFT JOIN (
      SELECT mst_brg_kode, SUM(mst_stok_in - mst_stok_out) AS total_stok 
      FROM tmasterstok_bahan WHERE mst_aktif = 'Y' GROUP BY mst_brg_kode
    ) stok ON stok.mst_brg_kode = b.bhn_kode
    WHERE b.bhn_aktif = 0 AND LEFT(b.Bhn_kode, 2) <> 'LL'
    ORDER BY b.Bhn_kode ASC
  `;
  const [rows] = await db.query(query);
  return rows;
};

const getBahanById = async (kode) => {
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
      LEFT(b.Bhn_kode, 2) AS kdJenis,
      MID(b.Bhn_kode, 3, 3) AS kdWarna,
      MID(b.Bhn_kode, 6, 2) AS kdGramasi,
      SUBSTRING(b.Bhn_kode, 8, 2) AS kdSetting,
      IFNULL(j.bj_nama, "") as nmJenis, IFNULL(w.bw_nama, "") as nmWarna, 
      IFNULL(g.bg_nama, "") as nmGramasi, IFNULL(s.bs_nama, "") as nmSetting,
      IFNULL(p.project, "REGULER") as project
    FROM tbahan b
    LEFT JOIN tbahan_jenis j ON j.bj_kode = LEFT(b.Bhn_kode, 2)
    LEFT JOIN tbahan_warna w ON w.bw_kode = MID(b.Bhn_kode, 3, 3)
    LEFT JOIN tbahan_gramasi g ON g.bg_kode = MID(b.Bhn_kode, 6, 2)
    LEFT JOIN tbahan_setting s ON s.bs_kode = SUBSTRING(b.Bhn_kode, 8, 2)
    LEFT JOIN tbahan_project p ON p.kode = MID(b.Bhn_kode, 10, 1)
    WHERE b.Bhn_kode = ?
  `;
  const [rows] = await db.query(query, [kode]);
  return rows[0];
};

const createBahan = async (data, user) => {
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
    throw new Error(
      `Master bahan dengan kode ${generatedKode} sudah ada di database.`,
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

const updateBahan = async (kode, data, user) => {
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

const deleteBahan = async (kode) => {
  // Soft delete ala Delphi (bhn_aktif = 1)
  await db.query("UPDATE tbahan SET bhn_aktif = 1 WHERE bhn_kode = ?", [kode]);
};

// --- LOOKUP QUERIES ---
const getLookups = async (category) => {
  let query = "";
  switch (category) {
    case "jenis":
      query =
        "SELECT bj_kode AS Kode, bj_nama AS Nama FROM tbahan_jenis ORDER BY bj_kode";
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
    case "satuan":
      query =
        "SELECT Satuan AS Kode, Satuan AS Nama FROM tbahan_satuan WHERE Satuan <> 'YARD'";
      break;
    default:
      return [];
  }
  const [rows] = await db.query(query);
  return rows;
};

module.exports = {
  getBrowseBahan,
  getBahanById,
  createBahan,
  updateBahan,
  deleteBahan,
  getLookups,
};
