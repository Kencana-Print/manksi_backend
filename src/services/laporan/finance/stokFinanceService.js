const db = require("../../../config/database");

// ── Daftar cabang yang valid ───────────────────────────────────────────
// Delphi: cbcab diisi dari data cabang yang ada di sistem
const getCabangList = async () => {
  // Ambil dari DB dulu
  const [rows] = await db.query(
    `SELECT DISTINCT cab FROM (
       SELECT mst_cab AS cab
       FROM finance.tmasterstok_finance
       UNION
       SELECT mso_cab AS cab
       FROM tgarmenmso_hdr
       WHERE mso_bagian = 'FINANCE'
       UNION
       SELECT cabang AS cab
       FROM finance.tcabang
     ) x
     ORDER BY cab`,
  );
  const fromDb = rows.map((r) => r.cab);

  // Tambahkan HO- jika belum ada — sesuai Delphi yang selalu menampilkan HO-
  if (!fromDb.includes("HO-")) fromDb.unshift("HO-");

  return fromDb;
};

// ── Stok Finance Master ───────────────────────────────────────────────
// Delphi btnRefreshClick — query persis sama struktur 3-level nested
//
// Layer terluar: SELECT y.*, (y.stk - y.Mutasi) AS REAL
//
// Layer tengah (y): dari tgarmen_brg WHERE brg_kode IN
//   (kode yang punya stok ≠ 0 di tmasterstok_finance)
//   dengan 2 correlated subquery:
//     stk    = SUM(mst_stok_in - mst_stok_out) dari tmasterstok_finance
//     Mutasi = SUM(msod_jumlah) dari tgarmenmso_hdr+dtl
//              WHERE mso_msi_nomor='' (belum di-MSI) AND mso_bagian='FINANCE'
//
// Nama: IF(brg_note='', brg_nama, CONCAT(brg_nama, ' - ', brg_note))
// ORDER: brg_jenis, brg_nama
const getMaster = async (cabang) => {
  const [rows] = await db.query(
    `SELECT
       y.Jenis,
       y.Kode,
       y.Nama,
       y.Satuan,
       y.stk    AS Stok,
       y.Mutasi,
       (y.stk - y.Mutasi) AS REAL_
     FROM (
       SELECT
         b.brg_jenis  AS Jenis,
         b.brg_kode   AS Kode,
         IF(b.brg_note = '',
           b.brg_nama,
           CONCAT(b.brg_nama, ' - ', b.brg_note)
         )             AS Nama,
         b.brg_satuan AS Satuan,

         -- Stok: SUM in-out dari tmasterstok_finance per barang+cabang
         IFNULL((
           SELECT SUM(m.mst_stok_in - m.mst_stok_out)
           FROM finance.tmasterstok_finance m
           WHERE m.mst_aktif    = 'Y'
             AND m.mst_cab      = ?
             AND m.mst_brg_kode = b.brg_kode
         ), 0) AS stk,

         -- Mutasi: qty MSO yang belum di-MSI (mso_msi_nomor='')
         -- untuk cabang+bagian FINANCE
         IFNULL((
           SELECT IFNULL(SUM(d.msod_jumlah), 0)
           FROM tgarmenmso_hdr h
           INNER JOIN tgarmenmso_dtl d
                   ON d.msod_nomor = h.mso_nomor
           WHERE h.mso_msi_nomor = ''
             AND h.mso_cab       = ?
             AND h.mso_bagian    = 'FINANCE'
             AND d.msod_brg_kode = b.brg_kode
         ), 0) AS Mutasi

       FROM tgarmen_brg b
       WHERE b.brg_kode IN (
         -- Hanya barang yang punya stok ≠ 0 di cabang ini
         SELECT x.mst_brg_kode
         FROM (
           SELECT
             m.mst_brg_kode,
             SUM(m.mst_stok_in - m.mst_stok_out) AS stk
           FROM finance.tmasterstok_finance m
           WHERE m.mst_aktif = 'Y'
             AND m.mst_cab   = ?
           GROUP BY m.mst_brg_kode
         ) x
         WHERE x.stk <> 0
       )
       ORDER BY b.brg_jenis, b.brg_nama
     ) y`,
    [cabang, cabang, cabang],
  );
  return rows;
};

// ── Detail per barang ─────────────────────────────────────────────────
// Dari tmasterstok_finance — semua mutasi per barang di cabang tsb
// Untuk expanded row detail
const getDetail = async (cabang) => {
  const [rows] = await db.query(
    `SELECT
       m.mst_brg_kode                         AS Kode,
       DATE_FORMAT(m.mst_tanggal, '%Y-%m-%d')  AS Tanggal,
       IFNULL(m.mst_noreferensi, '')           AS Nomor,
       IFNULL(m.mst_mb_nomor, '')              AS NoMB,
       IFNULL(m.mst_jenis, '')                 AS Jenis,
       m.mst_stok_in                           AS StokIn,
       m.mst_stok_out                          AS StokOut,
       (m.mst_stok_in - m.mst_stok_out)        AS Selisih
     FROM finance.tmasterstok_finance m
     WHERE m.mst_aktif = 'Y'
       AND m.mst_cab   = ?
     ORDER BY m.mst_brg_kode, m.mst_tanggal, m.mst_noreferensi`,
    [cabang],
  );
  return rows;
};

module.exports = { getCabangList, getMaster, getDetail };
