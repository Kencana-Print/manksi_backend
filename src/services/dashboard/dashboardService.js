const db = require("../../config/database");

const RANGE_DAYS = 90;

// ── Helper: apakah user ini "super viewer" (lihat semua) ──
const isSuperViewer = (user) => {
  const kode = (user.kode || "").toUpperCase();
  const bagian = (user.bagian || "").toUpperCase();
  return (
    kode === "ADMIN" ||
    bagian === "ADMIN" ||
    bagian === "DIR" ||
    bagian === "DIREKSI"
  );
};

// ──────────────────────────────────────────────
// 1. SPK Urgent (sudah ada di login, tapi bisa di-refresh)
// ──────────────────────────────────────────────
const getSpkUrgent = async (user) => {
  const isMarketing = (user.bagian || "").toUpperCase() === "MARKETING";
  const super_ = isSuperViewer(user);

  let sql = `
    SELECT
      s.spk_nomor    AS Spk,
      s.spk_nama     AS Nama,
      c.Cus_nama     AS Customer,
      DATE_FORMAT(s.spk_tanggal,  '%d-%m-%Y') AS Tanggal,
      DATE_FORMAT(s.spk_dateline, '%d-%m-%Y') AS Dateline,
      s.spk_jumlah       AS QtyOrder,
      s.spk_jumlah_jadi  AS QtyJadi,
      s.spk_divisi   AS Divisi,
      s.spk_cab      AS Cab,
      s.spk_workshop AS Workshop,
      DATEDIFF(s.spk_dateline, CURDATE()) AS SisaHari
    FROM tspk s
    LEFT JOIN tcustomer c ON c.Cus_kode = s.spk_cus_kode
    WHERE s.spk_aktif = 'Y'
      AND s.spk_close = 0
      AND s.spk_cus_kode IN (
            SELECT cus_kode FROM tcustomer WHERE cus_keramat = 'Y'
          )
      AND s.spk_tanggal >= '2024-01-01'
      AND DATEDIFF(s.spk_dateline, CURDATE()) <= 3
  `;

  // Non-super & non-marketing: filter per divisi
  if (!super_ && !isMarketing && user.divisi) {
    sql += ` AND s.spk_divisi = ${db.escape(String(user.divisi))}`;
  }

  sql += ` ORDER BY s.spk_dateline ASC`;

  const [rows] = await db.query(sql);
  return rows;
};

// ──────────────────────────────────────────────
// 2. Ringkasan Penawaran vs SPK (bulan berjalan)
// ──────────────────────────────────────────────
const getPenawaranSummary = async (user) => {
  const super_ = isSuperViewer(user);
  let whereExtra = "";
  if (!super_ && user.divisi) {
    whereExtra = `AND h.pen_divisi = ${db.escape(String(user.divisi))}`;
  }

  const sql = `
    SELECT
      COUNT(DISTINCT h.pen_nomor) AS TotalPenawaran,
      COUNT(DISTINCT CASE WHEN s.spk_pen_nomor IS NOT NULL 
                          THEN h.pen_nomor END) AS SudahSpk,
      COUNT(DISTINCT CASE WHEN s.spk_pen_nomor IS NULL 
                          THEN h.pen_nomor END) AS BelumSpk
    FROM tpenawaran_hdr h
    LEFT JOIN tspk s ON s.spk_pen_nomor = h.pen_nomor 
                     AND s.spk_aktif = 'Y'
    WHERE h.pen_tanggal >= DATE_SUB(CURDATE(), INTERVAL ${RANGE_DAYS} DAY)
      AND h.pen_tanggal <= CURDATE()
      ${whereExtra}
  `;

  const [rows] = await db.query(sql);
  return rows[0];
};

// ──────────────────────────────────────────────
// 3. List Penawaran belum ada SPK
// ──────────────────────────────────────────────
const getPenawaranBelumSpk = async (user, limit = 20, offset = 0) => {
  const super_ = isSuperViewer(user);
  let whereExtra = "";
  if (!super_ && user.divisi)
    whereExtra = `AND h.pen_divisi = ${db.escape(String(user.divisi))}`;

  const sql = `
    SELECT
        h.pen_nomor         AS Nomor,
        h.pen_tanggal       AS Tanggal,
        c.cus_nama          AS NamaCustomer,
        h.pen_keterangan    AS Keterangan,
        v.Divisi            AS Divisi,
        DATEDIFF(CURDATE(), h.pen_tanggal) AS UmurHari
    FROM tpenawaran_hdr h
    INNER JOIN tcustomer c ON h.pen_cus_kode = c.cus_kode
    LEFT  JOIN tdivisi v   ON v.kode = h.pen_divisi
    LEFT  JOIN tspk s      ON s.spk_pen_nomor = h.pen_nomor 
                            AND s.spk_aktif = 'Y'
    WHERE h.pen_tanggal >= DATE_SUB(CURDATE(), INTERVAL ${RANGE_DAYS} DAY)
        AND h.pen_tanggal <= CURDATE()
        AND s.spk_nomor IS NULL   -- penawaran yang tidak punya SPK
        ${whereExtra}
    ORDER BY h.pen_tanggal ASC
    LIMIT ? OFFSET ?
    `;
  const [rows] = await db.query(sql, [limit, offset]);
  return rows;
};

// ──────────────────────────────────────────────
// 4. Ringkasan SPK aktif (per status produksi)
//    Berguna untuk semua bagian produksi
// ──────────────────────────────────────────────
const getSpkSummary = async (user) => {
  const super_ = isSuperViewer(user);

  let whereExtra = "";
  if (!super_ && user.divisi) {
    whereExtra = `AND spk_divisi = ${db.escape(String(user.divisi))}`;
  }

  const sql = `
    SELECT
      COUNT(*)                                                        AS TotalAktif,
      SUM(CASE WHEN DATEDIFF(spk_dateline, CURDATE()) < 0  THEN 1 ELSE 0 END) AS Terlambat,
      SUM(CASE WHEN DATEDIFF(spk_dateline, CURDATE()) = 0  THEN 1 ELSE 0 END) AS DeadlineHariIni,
      SUM(CASE WHEN DATEDIFF(spk_dateline, CURDATE()) BETWEEN 1 AND 3
                                                               THEN 1 ELSE 0 END) AS SegeredDeadline,
      SUM(CASE WHEN spk_jumlah_jadi >= spk_jumlah          THEN 1 ELSE 0 END) AS Selesai
    FROM tspk
    WHERE spk_aktif = 'Y'
      AND spk_close = 0
      AND spk_tanggal >= '2024-01-01'
      ${whereExtra}
  `;

  const [rows] = await db.query(sql);
  return rows[0];
};

// ── PO Bahan dengan sisa MKB (seminggu terakhir) ──
const getPoBahanSisa = async (user) => {
  const bagian = (user.bagian || "").toUpperCase();
  // Hanya untuk bagian yang relevan
  const allowed = ["PEMBELIAN", "GUDANG", "PPIC"];
  if (!allowed.includes(bagian) && !isSuperViewer(user)) return null;

  const sql = `
    SELECT COUNT(DISTINCT h.po_Nomor) AS TotalPO,
           SUM(CASE WHEN sisa.ada_sisa = 1 THEN 1 ELSE 0 END) AS PoAdaSisa
    FROM tpo_hdr h
    LEFT JOIN (
      SELECT d.pod_po_nomor,
             MAX(CASE WHEN (d.pod_Jumlah - IFNULL(m1.jumlah,0) - IFNULL(m2.jumlah,0)) > 0
                      THEN 1 ELSE 0 END) AS ada_sisa
      FROM tpo_dtl d
      LEFT JOIN (
        SELECT mkbd_mkb_nomor, mkbd_bhn_kode, SUM(mkbd_jumlah_PO) AS jumlah
        FROM tmkb_dtl GROUP BY mkbd_mkb_nomor, mkbd_bhn_kode
      ) m1 ON m1.mkbd_mkb_nomor = d.pod_mkb_nomor
           AND m1.mkbd_bhn_kode  = d.pod_bhn_kode
      LEFT JOIN (
        SELECT o.mkbd2_po_nomor, o.mkbd2_pourut, SUM(p.mkbd_jumlah_PO) AS jumlah
        FROM tmkb_dtl2 o
        LEFT JOIN tmkb_dtl p ON p.mkbd_mkb_nomor = o.mkbd2_mkb_nomor
                             AND p.mkbd_nourut    = o.mkbd2_nourut
        GROUP BY o.mkbd2_po_nomor, o.mkbd2_pourut
      ) m2 ON m2.mkbd2_po_nomor = d.pod_po_nomor
           AND m2.mkbd2_pourut   = d.pod_nourut
      GROUP BY d.pod_po_nomor
    ) sisa ON sisa.pod_po_nomor = h.po_Nomor
    WHERE h.po_jenis <> 1
      AND h.po_Tanggal >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      AND h.po_Tanggal <= CURDATE()
  `;

  const [rows] = await db.query(sql);
  return rows[0];
};

// ── PO Bahan vs BPB summary (bulan berjalan) ──
const getPoBahanVsBpbSummary = async (user) => {
  const bagian = (user.bagian || "").toUpperCase();
  const allowed = ["PEMBELIAN", "GUDANG", "PPIC"];
  if (!allowed.includes(bagian) && !isSuperViewer(user)) return null;

  const sql = `
    SELECT
      COUNT(*)                                                        AS TotalPO,
      SUM(CASE WHEN h.po_close = 0 THEN 1 ELSE 0 END)               AS Open,
      SUM(CASE WHEN h.po_close = 2 THEN 1 ELSE 0 END)               AS OnProses,
      SUM(CASE WHEN h.po_close = 1 THEN 1 ELSE 0 END)               AS Close
    FROM tpo_hdr h
    WHERE h.po_jenis <> 1
      AND h.po_tanggal >= DATE_FORMAT(NOW(), '%Y-%m-01')
      AND h.po_tanggal <= CURDATE()
  `;

  const [rows] = await db.query(sql);
  return rows[0];
};

module.exports = {
  getSpkUrgent,
  getPenawaranSummary,
  getPenawaranBelumSpk,
  getSpkSummary,
  getPoBahanSisa,
  getPoBahanVsBpbSummary,
};
