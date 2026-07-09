const db = require("../../config/database");

// ============================================================
// PROOF GARMEN — BROWSE SERVICE
// Migrasi dari ufrmBrowseProofGarmen.pas
// ============================================================

const CABANG_OPTIONS = ["ALL", "P01", "P04"];

// --- GET BROWSE MASTER ---
const getBrowse = async ({ startDate, endDate, cab }) => {
  let where = `WHERE h.pf_tanggal >= ? AND h.pf_tanggal <= ?`;
  const params = [startDate, endDate];

  if (cab && cab !== "ALL") {
    where += ` AND h.pf_cab = ?`;
    params.push(cab);
  }

  // Union 3 sumber nama: tsalesorder (SO baru), tspk (SPK PPIC + SO
  // legacy aktif), tmemospk (MAP) — sesuai pola migrasi konsisten
  // yang diterapkan di modul lain, karena pf_spk_nomor bisa merujuk
  // ke salah satu dari ketiganya.
  const sql = `
    SELECT
      h.pf_nomor AS Nomor,
      DATE_FORMAT(h.pf_tanggal, '%Y-%m-%d') AS Tanggal,
      h.pf_cab AS Cab,
      h.pf_lini AS Lini,
      h.pf_spk_nomor AS Spk,
      x.spk_nama AS NamaSpk,
      h.pf_petugas AS Petugas,
      h.pf_jam AS Jam
    FROM tproofgarmen_hdr h
    LEFT JOIN (
      SELECT so_nomor AS spk_nomor, so_nama AS spk_nama FROM tsalesorder
      UNION ALL
      SELECT spk_nomor, spk_nama FROM tspk WHERE spk_aktif = 'Y'
      UNION ALL
      SELECT mspk_nomor, mspk_nama FROM tmemospk
    ) x ON x.spk_nomor = h.pf_spk_nomor
    ${where}
    ORDER BY h.pf_nomor
  `;
  const [rows] = await db.query(sql, params);
  return rows;
};

// --- GET DETAIL BULK (untuk expand grid / export detail) ---
// Sesuai Delphi SQLDetail: bukan per-nomor, tapi seluruh detail
// dalam rentang tanggal+cabang yang sama dengan master.
const getDetailBulk = async ({ startDate, endDate, cab }) => {
  let where = `WHERE h.pf_tanggal >= ? AND h.pf_tanggal <= ?`;
  const params = [startDate, endDate];

  if (cab && cab !== "ALL") {
    where += ` AND h.pf_cab = ?`;
    params.push(cab);
  }

  const sql = `
    SELECT
      d.pfd_nomor AS Nomor,
      d.pfd_kode AS Kode,
      b.Bhn_Name AS NamaKomponen,
      d.pfd_size AS Size,
      d.pfd_jenis_kain AS JenisKain,
      d.pfd_warna_kain AS WarnaKain,
      d.pfd_jumlah AS Jumlah,
      d.pfd_waktu AS WaktuKerja
    FROM tproofgarmen_dtl d
    INNER JOIN tproofgarmen_hdr h ON h.pf_nomor = d.pfd_nomor
    LEFT JOIN tbahan b ON b.Bhn_kode = d.pfd_kode
    ${where}
    ORDER BY d.pfd_nomor
  `;
  const [rows] = await db.query(sql, params);
  return rows;
};

// --- GET DETAIL by satu nomor (untuk expand row per baris) ---
const getDetailByNomor = async (nomor) => {
  const [rows] = await db.query(
    `SELECT
       d.pfd_nomor AS Nomor,
       d.pfd_kode AS Kode,
       b.Bhn_Name AS NamaKomponen,
       d.pfd_size AS Size,
       d.pfd_jenis_kain AS JenisKain,
       d.pfd_warna_kain AS WarnaKain,
       d.pfd_jumlah AS Jumlah,
       d.pfd_waktu AS WaktuKerja
     FROM tproofgarmen_dtl d
     LEFT JOIN tbahan b ON b.Bhn_kode = d.pfd_kode
     WHERE d.pfd_nomor = ?`,
    [nomor],
  );
  return rows;
};

// --- DELETE — validasi cabang sesuai Delphi cxButton4Click ---
const deleteData = async (nomor, userCab) => {
  const [rows] = await db.query(
    `SELECT pf_cab FROM tproofgarmen_hdr WHERE pf_nomor = ?`,
    [nomor],
  );
  if (rows.length === 0) throw new Error("Data tidak ditemukan.");

  // User pusat (cabang kosong/HO-) boleh akses semua cabang; user
  // cabang spesifik hanya boleh akses datanya sendiri.
  if (userCab && userCab !== "HO-" && rows[0].pf_cab !== userCab) {
    throw new Error("Data tsb bukan cabang anda.");
  }

  // Sesuai Delphi: hanya hapus header, tidak menghapus detail secara
  // eksplisit (kemungkinan FK cascade di DB, dipertahankan 1:1).
  await db.query(`DELETE FROM tproofgarmen_hdr WHERE pf_nomor = ?`, [nomor]);
};

// --- Default cabang untuk tombol Tambah — sesuai Delphi cxButton2Click ---
const resolveDefaultCabForCreate = (userCab, filterCab) => {
  if (userCab && userCab !== "HO-") return userCab;
  if (filterCab === "ALL" || !filterCab) return "P04";
  return filterCab;
};

module.exports = {
  CABANG_OPTIONS,
  getBrowse,
  getDetailBulk,
  getDetailByNomor,
  deleteData,
  resolveDefaultCabForCreate,
};
