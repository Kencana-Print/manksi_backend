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
  // Ekstraksi Kode via PREFIX-MATCHING ke tbahan (bukan menebak
  // separator) — data mst_brg_kode ternyata sangat tidak konsisten:
  // kadang pakai '-', kadang huruf (K/R), kadang TANPA separator
  // sama sekali (barcode 16 digit murni). Satu-satunya cara yang
  // robust terhadap semua variasi ini: coba cocokkan prefix 8/9/10
  // karakter langsung ke kode yang BENAR-BENAR ada di tbahan.
  let where = `c.mst_aktif = 'Y' AND c.mst_tanggal <= ?`;
  const params = [tanggal];
  if (kodeBahan) {
    where += ` AND (
      LEFT(c.mst_brg_kode, 9) = ?
      OR LEFT(c.mst_brg_kode, 8) = ?
      OR LEFT(c.mst_brg_kode, 10) = ?
    )`;
    params.push(kodeBahan, kodeBahan, kodeBahan);
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
        WHEN DATEDIFF(?, h.bar_tanggal) > 720 THEN 'Dead Stock'
        WHEN DATEDIFF(?, h.bar_tanggal) > 360 THEN 'Slowmoving'
        WHEN DATEDIFF(?, h.bar_tanggal) >= 180 THEN 'Perhatian'
        ELSE ''
      END AS Status
    FROM (
      SELECT
        c.mst_brg_kode AS Barcode,
        COALESCE(b9.Bhn_kode, b10.Bhn_kode, b8.Bhn_kode) AS Kode,
        SUM(c.mst_stok_in - c.mst_stok_out) AS Stok
      FROM tmasterstok_barcode c
      LEFT JOIN tbahan b9 ON b9.Bhn_kode = LEFT(c.mst_brg_kode, 9)
      LEFT JOIN tbahan b10 ON b10.Bhn_kode = LEFT(c.mst_brg_kode, 10)
      LEFT JOIN tbahan b8 ON b8.Bhn_kode = LEFT(c.mst_brg_kode, 8)
      WHERE ${where}
      GROUP BY c.mst_brg_kode
    ) x
    LEFT JOIN tbahan b ON b.Bhn_kode = x.Kode
    LEFT JOIN tbahan_barcode_dtl d ON d.bard_barcode = x.Barcode
    LEFT JOIN tbahan_barcode_hdr h ON h.bar_nomor = d.bard_nomor
    WHERE x.Stok <> 0
    ORDER BY b.Bhn_Name, x.Barcode
  `;
  const [rows] = await db.query(sql, [
    ...params,
    tanggal,
    tanggal,
    tanggal,
    tanggal,
  ]);
  return rows;
};

module.exports = { getBrowse };
