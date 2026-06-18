const db = require("../../../config/database");

// ── 1. Rekap summary per sales + divisi ──
const getRekap = async (query) => {
  const { bulan, tahun } = query;
  const bln = bulan || new Date().getMonth() + 1;
  const thn = tahun || new Date().getFullYear();

  const sql = `
    SELECT
      a.sales                                               AS Sales,
      a.perush                                              AS Perush,
      a.divisi                                              AS Divisi,
      COUNT(a.Nomor)                                        AS JmlPenawaran,
      SUM(a.qty)                                            AS Qty,
      SUM(a.nominal)                                        AS Nominal,
      SUM(a.realisasi)                                      AS Realisasi,
      CASE WHEN SUM(a.nominal) > 0
        THEN ROUND(SUM(a.realisasi) / SUM(a.nominal) * 100, 2)
        ELSE 0 END                                          AS Presentase,
      SUM(a.batal)                                          AS Batal,
      CASE WHEN SUM(a.nominal) > 0
        THEN ROUND(SUM(a.batal) / SUM(a.nominal) * 100, 2)
        ELSE 0 END                                          AS PresentaseBatal,
      SUM(a.confirm)                                        AS Confirm,
      CASE WHEN SUM(a.nominal) > 0
        THEN ROUND(SUM(a.confirm) / SUM(a.nominal) * 100, 2)
        ELSE 0 END                                          AS PresentaseConfirm
    FROM (
      SELECT r.*, SUM(d.pend_qty) AS qty
      FROM rekappenawaran r
      INNER JOIN rekappenawarandtl d ON d.pend_pen_nomor = r.Nomor
      GROUP BY r.Nomor
    ) a
    WHERE MONTH(a.tanggal) = ?
      AND YEAR(a.tanggal)  = ?
    GROUP BY a.sales, a.perush, a.divisi
    ORDER BY a.sales ASC, a.perush ASC, a.divisi ASC
  `;

  const [rows] = await db.query(sql, [bln, thn]);
  return rows;
};

// ── 2. Detail per divisi ──
const getDetail = async (query) => {
  const { bulan, tahun, divisi } = query;
  const bln = bulan || new Date().getMonth() + 1;
  const thn = tahun || new Date().getFullYear();
  const div = (divisi || "SPANDUK").toUpperCase();

  const sql = `
    SELECT
      r.Nomor                                               AS Nomor,
      DATE_FORMAT(r.tanggal, '%d-%m-%Y')                   AS Tanggal,
      c.cus_nama                                            AS Customer,
      r.perush                                              AS Perusahaan,
      r.sales                                               AS Sales,
      IF(d.pend_status = '', 'OPEN', d.pend_status)        AS Status,
      IF(d.pend_status = 'BATAL', d.pend_batal,
        IF(d.pend_status = '', d.pend_confirm, ''))         AS Note,
      d.pend_nama_barang                                    AS Nama,
      d.pend_ukuran                                         AS Ukuran,
      d.pend_bahan                                          AS Bahan,
      d.pend_harga                                          AS Harga,
      d.pend_qty                                            AS Qty,
      (d.pend_harga * d.pend_qty)                          AS Nilai,
      IF((r.cetaktotal = 0 AND d.pend_status = ''),
        'ALTERNATIF', '')                                   AS Keterangan
    FROM rekappenawaran r
    INNER JOIN tcustomer c     ON c.cus_kode   = r.customer
    INNER JOIN tpenawaran_dtl d ON d.pend_pen_nomor = r.Nomor
    WHERE MONTH(r.tanggal) = ?
      AND YEAR(r.tanggal)  = ?
      AND r.divisi         = ?
      AND d.pend_batal NOT LIKE 'HANYA ALTERNATIF%'
    ORDER BY r.tanggal ASC, r.Nomor ASC
  `;

  const [rows] = await db.query(sql, [bln, thn, div]);
  return rows;
};

module.exports = { getRekap, getDetail };
