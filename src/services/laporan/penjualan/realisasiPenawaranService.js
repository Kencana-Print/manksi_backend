const db = require("../../../config/database");

// --- 1. GET BROWSE HEADER (Master Agregasi) ---
const getBrowse = async (query) => {
  const { startDate, endDate } = query;

  // Default tanggal: Awal bulan s/d Hari ini
  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  const sql = `
    WITH Aggregated AS (
      SELECT 
        h.pen_divisi,
        h.pen_cus_kode,
        v.Divisi AS Divisi,
        c.cus_nama AS Customer,
        COUNT(d.pend_id) AS Jumlah,
        SUM(d.pend_qty) AS Qty,
        MAX(d.pend_satuan) AS Satuan,
        SUM(d.pend_qty * d.pend_harga) AS Nominal,
        SUM(CASE WHEN UPPER(d.pend_status) = 'CLOSE' THEN (d.pend_qty * d.pend_harga) ELSE 0 END) AS CloseVal,
        SUM(CASE WHEN UPPER(d.pend_status) = 'BATAL' THEN (d.pend_qty * d.pend_harga) ELSE 0 END) AS BatalVal,
        SUM(CASE WHEN d.pend_status IS NULL OR d.pend_status = '' THEN (d.pend_qty * d.pend_harga) ELSE 0 END) AS OpenVal
      FROM tpenawaran_dtl d
      INNER JOIN tpenawaran_hdr h ON h.pen_nomor = d.pend_pen_nomor
      LEFT JOIN tdivisi v ON v.kode = h.pen_divisi
      LEFT JOIN tcustomer c ON c.cus_kode = h.pen_cus_kode
      WHERE h.pen_tanggal >= ? AND h.pen_tanggal <= ?
      GROUP BY h.pen_divisi, h.pen_cus_kode
    )
    SELECT 
      Divisi,
      Customer,
      Jumlah,
      Qty,
      Satuan,
      Nominal,
      CloseVal AS \`Close\`,
      IF(Nominal > 0, (CloseVal / Nominal) * 100, 0) AS PercClose,
      BatalVal AS Batal,
      IF(Nominal > 0, (BatalVal / Nominal) * 100, 0) AS PercBatal,
      OpenVal AS \`Open\`,
      IF(Nominal > 0, (OpenVal / Nominal) * 100, 0) AS PercOpen
    FROM Aggregated
    ORDER BY Divisi ASC, Customer ASC
  `;

  const [rows] = await db.query(sql, [dStart, dEnd]);
  return rows;
};

// --- 2. GET RINGKASAN PER DIVISI (untuk Dashboard) ---
const getDashboardSummary = async () => {
  // Bulan berjalan saja — cukup untuk widget dashboard
  const sql = `
    SELECT
      IFNULL(v.Divisi, 'LAINNYA')          AS Divisi,
      SUM(d.pend_qty * d.pend_harga)        AS Nominal,
      SUM(CASE WHEN UPPER(d.pend_status) = 'CLOSE'
               THEN d.pend_qty * d.pend_harga ELSE 0 END) AS Close,
      SUM(CASE WHEN UPPER(d.pend_status) = 'BATAL'
               THEN d.pend_qty * d.pend_harga ELSE 0 END) AS Batal,
      SUM(CASE WHEN d.pend_status IS NULL OR d.pend_status = ''
               THEN d.pend_qty * d.pend_harga ELSE 0 END) AS Open
    FROM tpenawaran_dtl d
    INNER JOIN tpenawaran_hdr h ON h.pen_nomor = d.pend_pen_nomor
    LEFT  JOIN tdivisi v        ON v.kode = h.pen_divisi
    WHERE h.pen_tanggal >= DATE_FORMAT(NOW(), '%Y-%m-01')
      AND h.pen_tanggal <= CURDATE()
    GROUP BY h.pen_divisi
    ORDER BY Nominal DESC
  `;
  const [rows] = await db.query(sql);
  return rows;
};

module.exports = { getBrowse, getDashboardSummary };
