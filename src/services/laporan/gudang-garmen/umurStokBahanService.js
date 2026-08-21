const db = require("../../../config/database");

// ─────────────────────────────────────────────
// LAPORAN UMUR STOK BAHAN — single header, tanpa detail.
// Umur dihitung dari bar_tanggal (tanggal cetak barcode) sampai
// tanggal filter. Hanya barcode dengan stok <> 0 yang ditampilkan
// (konsisten dengan pola janganTampilkanKosongDetail di laporan
// Stok Bahan Barcode).
// Perhatian  = umur 60–90 hari
// Slowmoving = umur > 90 hari
// Barcode tanpa tbahan_barcode_hdr (data lama/legacy tanpa histori
// cetak) tetap ditampilkan dengan TanggalCetak/Umur/Status kosong,
// bukan di-exclude — supaya stok tidak "hilang" dari laporan.
// ─────────────────────────────────────────────
const getBrowse = async (tanggal, kodeBahan = "") => {
  let where = `c.mst_aktif = 'Y' AND c.mst_tanggal <= ?`;
  const params = [tanggal];
  if (kodeBahan) {
    where += ` AND LEFT(c.mst_brg_kode, LENGTH(c.mst_brg_kode)-7) = ?`;
    params.push(kodeBahan);
  }
  const sql = `
    SELECT
      x.Kode,
      b.Bhn_Name AS Nama,
      b.Bhn_satuan AS Satuan,
      x.Barcode,
      x.Stok,
      DATE_FORMAT(h.bar_tanggal, '%Y-%m-%d') AS TanggalCetak,
      IF(h.bar_tanggal IS NULL, NULL, DATEDIFF(?, h.bar_tanggal)) AS Umur,
      CASE
        WHEN h.bar_tanggal IS NULL THEN ''
        WHEN DATEDIFF(?, h.bar_tanggal) BETWEEN 60 AND 90 THEN 'Perhatian'
        WHEN DATEDIFF(?, h.bar_tanggal) > 90 THEN 'Slowmoving'
        ELSE ''
      END AS Status
    FROM (
      SELECT
        LEFT(c.mst_brg_kode, LENGTH(c.mst_brg_kode)-7) AS Kode,
        c.mst_brg_kode AS Barcode,
        SUM(c.mst_stok_in - c.mst_stok_out) AS Stok
      FROM tmasterstok_barcode c
      WHERE ${where}
      GROUP BY c.mst_brg_kode
    ) x
    LEFT JOIN tbahan b ON b.Bhn_kode = x.Kode
    LEFT JOIN tbahan_barcode_dtl d ON d.bard_barcode = x.Barcode
    LEFT JOIN tbahan_barcode_hdr h ON h.bar_nomor = d.bard_nomor
    WHERE x.Stok <> 0
    ORDER BY b.Bhn_Name, x.Barcode
  `;
  const [rows] = await db.query(sql, [...params, tanggal, tanggal, tanggal]);
  return rows;
};

module.exports = { getBrowse };
