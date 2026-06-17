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
    bagian === "DIREKSI" ||
    bagian === "AUDIT"
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
    WHERE 1=1
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
    WHERE s.spk_nomor IS NULL
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

// ── Penawaran Belum MAP (Marketing Dashboard) ──
const MARKETING_BAGIAN = [
  "MARKETING",
  "EDP",
  "DIREKSI",
  "OWNER",
  "IT",
  "FINANCE",
];

const getPenawaranBelumMap = async (user, limit = 20, offset = 0) => {
  const bagian = (user.bagian || "").toUpperCase();
  if (!MARKETING_BAGIAN.includes(bagian) && !isSuperViewer(user)) return [];

  let whereExtra = "";
  if (!isSuperViewer(user) && user.divisi) {
    whereExtra = `AND h.pen_divisi = ${db.escape(String(user.divisi))}`;
  }

  const sql = `
    SELECT
      h.pen_nomor       AS Nomor,
      h.pen_tanggal     AS Tanggal,
      c.cus_nama        AS NamaCustomer,
      h.pen_keterangan  AS Keterangan,
      COUNT(d.pend_id)  AS JmlItem,
      SUM(CASE WHEN d.pend_status = 'CLOSE' THEN 1 ELSE 0 END) AS ItemClose,
      DATEDIFF(CURDATE(), h.pen_tanggal) AS UmurHari
    FROM tpenawaran_hdr h
    INNER JOIN tpenawaran_dtl d ON d.pend_pen_nomor = h.pen_nomor
    INNER JOIN tcustomer c ON c.cus_kode = h.pen_cus_kode
    WHERE h.pen_tanggal >= DATE_SUB(CURDATE(), INTERVAL ${RANGE_DAYS} DAY)
      AND h.pen_tanggal <= CURDATE()
      AND NOT EXISTS (
        SELECT 1 FROM tmemospk m
        WHERE m.mspk_pen_nomor = h.pen_nomor AND m.mspk_aktif = 'Y'
      )
      ${whereExtra}
    GROUP BY h.pen_nomor, h.pen_tanggal, c.cus_nama, h.pen_keterangan
    HAVING ItemClose = 0
    ORDER BY h.pen_tanggal ASC
    LIMIT ? OFFSET ?
  `;

  const [rows] = await db.query(sql, [limit, offset]);
  return rows;
};

const getPenawaranMapSummary = async (user) => {
  const bagian = (user.bagian || "").toUpperCase();
  if (!MARKETING_BAGIAN.includes(bagian) && !isSuperViewer(user)) {
    return { TotalPenawaran: 0, SudahMAP: 0, BelumMAP: 0, BelumMAPAdaClose: 0 };
  }

  let whereExtra = "";
  if (!isSuperViewer(user) && user.divisi) {
    whereExtra = `AND h.pen_divisi = ${db.escape(String(user.divisi))}`;
  }

  const sql = `
    SELECT
      COUNT(DISTINCT h.pen_nomor) AS TotalPenawaran,
      COUNT(DISTINCT CASE WHEN m.mspk_nomor IS NOT NULL THEN h.pen_nomor END) AS SudahMAP,
      COUNT(DISTINCT CASE WHEN m.mspk_nomor IS NULL THEN h.pen_nomor END) AS BelumMAP,
      COUNT(DISTINCT CASE WHEN m.mspk_nomor IS NULL
        AND EXISTS (
          SELECT 1 FROM tpenawaran_dtl d2
          WHERE d2.pend_pen_nomor = h.pen_nomor AND d2.pend_status = 'CLOSE'
        ) THEN h.pen_nomor END) AS BelumMAPAdaClose
    FROM tpenawaran_hdr h
    LEFT JOIN tmemospk m ON m.mspk_pen_nomor = h.pen_nomor AND m.mspk_aktif = 'Y'
    WHERE h.pen_tanggal >= DATE_SUB(CURDATE(), INTERVAL ${RANGE_DAYS} DAY)
      AND h.pen_tanggal <= CURDATE()
      ${whereExtra}
  `;

  const [rows] = await db.query(sql);
  return rows[0];
};

const getKunjunganSalesSummary = async (user) => {
  const bagian = (user.bagian || "").toUpperCase();
  const allowed = [
    "MARKETING",
    "EDP",
    "DIREKSI",
    "OWNER",
    "IT",
    "FINANCE",
    "AUDIT",
  ];
  if (!allowed.includes(bagian) && !isSuperViewer(user)) return [];

  const sql = `
    SELECT 
      a.USER AS Nama_Sales,
      SUM(CASE 
        WHEN (a.Tanggal_Plan IS NOT NULL AND a.Tanggal_Plan != '0000-00-00')
          AND (a.realisasi = 'Y' OR (a.tanggal IS NOT NULL AND a.tanggal != '0000-00-00'))
        THEN 1 ELSE 0 END) AS Done,
      SUM(CASE 
        WHEN (a.Tanggal_Plan IS NOT NULL AND a.Tanggal_Plan != '0000-00-00')
          AND (a.realisasi != 'Y' AND (a.tanggal IS NULL OR a.tanggal = '0000-00-00'))
        THEN 1 ELSE 0 END) AS Failed,
      SUM(CASE 
        WHEN (a.Tanggal_Plan IS NULL OR a.Tanggal_Plan = '0000-00-00')
          AND (a.realisasi = 'Y' OR (a.tanggal IS NOT NULL AND a.tanggal != '0000-00-00'))
        THEN 1 ELSE 0 END) AS Unplan,
      COUNT(*) AS Total,

      /* ── Nominal Penawaran yang terbit setelah kunjungan ── */
      IFNULL((
        SELECT SUM(d.pend_qty * d.pend_harga)
        FROM tpenawaran_hdr ph
        INNER JOIN tpenawaran_dtl d ON d.pend_pen_nomor = ph.pen_nomor
        WHERE ph.pen_sal_kode = (
          SELECT sal_kode FROM tsales WHERE sal_nama = a.USER LIMIT 1
        )
        AND ph.pen_tanggal >= DATE_FORMAT(NOW(), '%Y-%m-01')
        AND ph.pen_tanggal <= CURDATE()
      ), 0) AS NominalPenawaran,

      IFNULL((
        SELECT SUM(mh.mh_harga_kalkulasi * mh.mh_jmlorder)
        FROM tmintaharga mh
        WHERE mh.mh_sal_kode = (
          SELECT sal_kode FROM tsales WHERE sal_nama = a.USER LIMIT 1
        )
        AND mh.mh_tanggal >= DATE_FORMAT(NOW(), '%Y-%m-01')
        AND mh.mh_tanggal <= CURDATE()
      ), 0) AS NominalMintaHarga

    FROM marketing.tkunjungan a
    WHERE DATE(a.Tanggal_Plan) BETWEEN DATE_FORMAT(NOW(), '%Y-%m-01') AND CURDATE()
       OR DATE(a.tanggal) BETWEEN DATE_FORMAT(NOW(), '%Y-%m-01') AND CURDATE()
    GROUP BY a.USER
    ORDER BY Done DESC, a.USER ASC
  `;

  const [rows] = await db.query(sql);
  return rows;
};

// ── Dashboard Piutang (AR) ──
const getPiutangDashboard = async (user) => {
  const bagian = (user.bagian || "").toUpperCase();
  const allowed = ["FINANCE", "DIREKSI", "OWNER", "AUDIT", "EDP", "IT"];
  if (!allowed.includes(bagian)) return null;

  // 1. Summary Angka
  const sqlSummary = `
    SELECT 
      (SELECT SUM(debet) 
      FROM piutang_debet 
      WHERE flag = 0) AS TotalDebet,
      
      (SELECT SUM(d.kredit) 
      FROM piutang_kredit_detail d
      INNER JOIN piutang_kredit_header h ON h.nomor = d.nomor
      INNER JOIN piutang_debet p ON p.nota = d.nota AND p.flag = 0
      ) AS TotalKredit,
      
      (SELECT SUM(debet) - SUM(
          IFNULL((
            SELECT SUM(kredit) FROM piutang_kredit_detail d 
            INNER JOIN piutang_kredit_header h ON h.nomor = d.nomor 
            WHERE d.nota = p.nota
          ), 0)
      ) FROM piutang_debet p WHERE p.flag = 0) AS TotalOutstanding,
      
      (SELECT SUM(debet) FROM piutang_debet 
      WHERE flag = 0 
      AND DATE_FORMAT(tanggal, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')
      ) AS InvoiceBulanIni,
      
      (SELECT SUM(d.kredit) 
      FROM piutang_kredit_detail d 
      INNER JOIN piutang_kredit_header h ON h.nomor = d.nomor 
      WHERE DATE_FORMAT(h.tanggal, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')
      ) AS TerimaBulanIni
  `;

  // 2. Top 5 Piutang Terbesar
  const sqlTop5 = `
    SELECT 
      c.cus_nama AS Customer,
      SUM(p.debet) - SUM(IFNULL((SELECT SUM(kredit) FROM piutang_kredit_detail d INNER JOIN piutang_kredit_header h ON h.nomor=d.nomor WHERE d.nota=p.nota), 0)) AS Saldo
    FROM piutang_debet p
    INNER JOIN tcustomer c ON c.cus_kode = p.customer
    WHERE p.flag=0
    GROUP BY p.customer
    HAVING Saldo > 0
    ORDER BY Saldo DESC
    LIMIT 10
  `;

  // 3. Invoice Jatuh Tempo (Overdue)
  const sqlOverdue = `
    SELECT 
      p.nota AS Invoice,
      c.cus_nama AS Customer,
      DATE_FORMAT(p.tanggal_tempo, '%d-%m-%Y') AS Tempo,
      DATEDIFF(CURDATE(), p.tanggal_tempo) AS TerlambatHari,
      (p.debet - IFNULL((SELECT SUM(kredit) FROM piutang_kredit_detail d INNER JOIN piutang_kredit_header h ON h.nomor=d.nomor WHERE d.nota=p.nota), 0)) AS SisaTagihan
    FROM piutang_debet p
    INNER JOIN tcustomer c ON c.cus_kode = p.customer
    WHERE p.flag=0 
      AND p.tanggal_tempo < CURDATE()
    HAVING SisaTagihan > 0
    ORDER BY TerlambatHari DESC
    LIMIT 20
  `;

  const sqlOverdueCount = `
    SELECT COUNT(*) AS Total
    FROM (
      SELECT p.nota,
        (p.debet - IFNULL((
          SELECT SUM(kredit) FROM piutang_kredit_detail d 
          INNER JOIN piutang_kredit_header h ON h.nomor = d.nomor 
          WHERE d.nota = p.nota
        ), 0)) AS SisaTagihan
      FROM piutang_debet p
      WHERE p.flag = 0 AND p.tanggal_tempo < CURDATE()
      HAVING SisaTagihan > 0
    ) x
  `;

  // 4. Trend 6 Bulan Terakhir (Tagihan vs Penerimaan)
  const sqlTrend = `
    SELECT 
      Bulan,
      SUM(Debet) AS TotalTagihan,
      SUM(Kredit) AS TotalPenerimaan
    FROM (
      SELECT DATE_FORMAT(tanggal, '%Y-%m') AS Bulan, debet AS Debet, 0 AS Kredit
      FROM piutang_debet
      WHERE flag = 0 AND tanggal >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 5 MONTH), '%Y-%m-01')
      UNION ALL
      SELECT DATE_FORMAT(h.tanggal, '%Y-%m') AS Bulan, 0 AS Debet, d.kredit AS Kredit
      FROM piutang_kredit_detail d
      INNER JOIN piutang_kredit_header h ON d.nomor = h.nomor
      WHERE h.tanggal >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 5 MONTH), '%Y-%m-01')
    ) x
    GROUP BY Bulan
    ORDER BY Bulan ASC
  `;

  const [[summary], [top5], [overdue], [overdueCount], [trend]] =
    await Promise.all([
      db.query(sqlSummary),
      db.query(sqlTop5),
      db.query(sqlOverdue),
      db.query(sqlOverdueCount),
      db.query(sqlTrend),
    ]);

  return {
    summary: { ...summary[0], overdueTotal: overdueCount[0]?.Total || 0 },
    top5,
    overdue,
    trend,
  };
};

const getPiutangOverdue = async (user, limit = 20, offset = 0) => {
  const bagian = (user.bagian || "").toUpperCase();
  const allowed = ["FINANCE", "DIREKSI", "OWNER", "AUDIT", "EDP", "IT"];
  if (!allowed.includes(bagian)) return [];

  const sql = `
    SELECT 
      p.nota AS Invoice,
      c.cus_nama AS Customer,
      DATE_FORMAT(p.tanggal_tempo, '%d-%m-%Y') AS Tempo,
      DATEDIFF(CURDATE(), p.tanggal_tempo) AS TerlambatHari,
      (p.debet - IFNULL((
        SELECT SUM(kredit) FROM piutang_kredit_detail d 
        INNER JOIN piutang_kredit_header h ON h.nomor = d.nomor 
        WHERE d.nota = p.nota
      ), 0)) AS SisaTagihan
    FROM piutang_debet p
    INNER JOIN tcustomer c ON c.cus_kode = p.customer
    WHERE p.flag = 0 
      AND p.tanggal_tempo < CURDATE()
    HAVING SisaTagihan > 0
    ORDER BY TerlambatHari DESC
    LIMIT ? OFFSET ?
  `;

  const [rows] = await db.query(sql, [limit, offset]);
  return rows;
};

const getPenerimaanSummary = async (user) => {
  const bagian = (user.bagian || "").toUpperCase();
  const allowed = ["FINANCE", "DIREKSI", "OWNER", "AUDIT", "EDP", "IT"];
  if (!allowed.includes(bagian)) return null;

  // Query 1: Total penerimaan & jumlah transaksi bulan ini
  const sqlPenerimaan = `
    SELECT
      IFNULL(SUM(debet), 0)  AS TotalPenerimaanBulanIni,
      COUNT(*)                AS JmlTransaksiBulanIni
    FROM terima_bayar_debet
    WHERE DATE_FORMAT(tanggal, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')
  `;

  // Query 2: Total kredit yang no_buktinya berasal dari penerimaan bulan ini
  // (artinya penerimaan bulan ini yang sudah diaplikasikan ke invoice)
  const sqlAplikasi = `
    SELECT IFNULL(SUM(d.kredit), 0) AS TotalSudahAplikasi
    FROM piutang_kredit_detail d
    INNER JOIN terima_bayar_debet t ON t.nomor = d.no_bukti
    WHERE DATE_FORMAT(t.tanggal, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')
  `;

  const [[rowPen], [rowApp]] = await Promise.all([
    db.query(sqlPenerimaan),
    db.query(sqlAplikasi),
  ]);

  const totalPenerimaan = Number(rowPen[0]?.TotalPenerimaanBulanIni) || 0;
  const jmlTransaksi = Number(rowPen[0]?.JmlTransaksiBulanIni) || 0;
  const sudahAplikasi = Number(rowApp[0]?.TotalSudahAplikasi) || 0;
  const belumAplikasi = Math.max(0, totalPenerimaan - sudahAplikasi);

  return {
    TotalPenerimaanBulanIni: totalPenerimaan,
    JmlTransaksiBulanIni: jmlTransaksi,
    SaldoBelumAplikasi: Math.round(belumAplikasi),
  };
};

// ── Dashboard Gudang Bahan ──
const getGudangBahanDashboard = async (user) => {
  const bagian = (user.bagian || "").toUpperCase();
  const allowed = [
    "PEMBELIAN",
    "GUDANG",
    "PPIC",
    "FINANCE",
    "EDP",
    "IT",
    "DIREKSI",
    "OWNER",
    "AUDIT",
  ];
  if (!allowed.includes(bagian) && !isSuperViewer(user)) return null;

  const cabang = user.cabangGarmen || "P04"; // default cabang garmen

  // ── 1. Metric: Total jenis bahan aktif ──
  const sqlTotalBahan = `
    SELECT COUNT(*) AS TotalJenis
    FROM tgarmen_brg
    WHERE brg_aktif = 'Y' AND brg_jenis = 'ACCESORIES'
  `;

  // ── 2. Metric: Item di bawah buffer ──
  // Hitung StokAkhir per barang lalu bandingkan dengan buffer
  const sqlBawahBuffer = `
    SELECT COUNT(*) AS JmlBawahBuffer
    FROM (
      SELECT
        b.brg_kode,
        b.brg_buffer,
        IFNULL(SUM(s.mst_stok_in - s.mst_stok_out), 0) AS StokAkhir
      FROM tgarmen_brg b
      LEFT JOIN tmasterstok_acc s ON s.mst_brg_kode = b.brg_kode
        AND s.mst_aktif = 'Y'
        AND s.mst_cab = ?
      WHERE b.brg_aktif = 'Y'
        AND b.brg_jenis = 'ACCESORIES'
        AND b.brg_buffer > 0
      GROUP BY b.brg_kode, b.brg_buffer
    ) x
    WHERE x.StokAkhir < x.brg_buffer
  `;

  // ── 3. Metric: Total barcode aktif (stok > 0) ──
  const sqlTotalBarcode = `
    SELECT COUNT(DISTINCT mst_brg_kode) AS TotalBarcode
    FROM tmasterstok_barcode
    WHERE mst_aktif = 'Y'
  `;

  // ── 4. Metric: Barcode stok minus ──
  const sqlBarcodeMinus = `
    SELECT COUNT(*) AS JmlMinus
    FROM (
      SELECT
        LEFT(mst_brg_kode, LENGTH(mst_brg_kode) - 7) AS Kode,
        SUM(mst_stok_in - mst_stok_out) AS Stok
      FROM tmasterstok_barcode
      WHERE mst_aktif = 'Y'
      GROUP BY LEFT(mst_brg_kode, LENGTH(mst_brg_kode) - 7)
      HAVING Stok < -0.1
    ) x
  `;

  // ── 5. Panel: Stok di bawah buffer (detail) ──
  const sqlDetailBawahBuffer = `
    SELECT Kode, Nama, Satuan, Buffer, StokAkhir
    FROM (
      SELECT
        b.brg_kode  AS Kode,
        IF(b.brg_note = '', b.brg_nama, CONCAT(b.brg_nama, ' - ', b.brg_note)) AS Nama,
        b.brg_satuan AS Satuan,
        b.brg_buffer AS Buffer,
        IFNULL(SUM(s.mst_stok_in - s.mst_stok_out), 0) AS StokAkhir
      FROM tgarmen_brg b
      LEFT JOIN tmasterstok_acc s ON s.mst_brg_kode = b.brg_kode
        AND s.mst_aktif = 'Y'
        AND s.mst_cab = ?
      WHERE b.brg_aktif = 'Y'
        AND b.brg_jenis = 'ACCESORIES'
        AND b.brg_buffer > 0
      GROUP BY b.brg_kode, b.brg_nama, b.brg_note, b.brg_satuan, b.brg_buffer
    ) x
    WHERE x.StokAkhir < x.Buffer
    ORDER BY (x.StokAkhir / x.Buffer) ASC
    LIMIT 20
  `;

  // ── 6. Panel: Top stok terbesar (detail) ──
  const sqlTopStok = `
    SELECT Kode, Nama, Satuan, Buffer, StokAkhir
    FROM (
      SELECT
        b.brg_kode  AS Kode,
        IF(b.brg_note = '', b.brg_nama, CONCAT(b.brg_nama, ' - ', b.brg_note)) AS Nama,
        b.brg_satuan AS Satuan,
        b.brg_buffer AS Buffer,
        IFNULL(SUM(s.mst_stok_in - s.mst_stok_out), 0) AS StokAkhir
      FROM tgarmen_brg b
      LEFT JOIN tmasterstok_acc s ON s.mst_brg_kode = b.brg_kode
        AND s.mst_aktif = 'Y'
        AND s.mst_cab = ?
      WHERE b.brg_aktif = 'Y'
        AND b.brg_jenis = 'ACCESORIES'
      GROUP BY b.brg_kode, b.brg_nama, b.brg_note, b.brg_satuan, b.brg_buffer
    ) x
    WHERE x.StokAkhir > 0
    ORDER BY x.StokAkhir DESC
    LIMIT 10
  `;

  // ── 7. Panel: Stok bahan barcode ringkasan ──
  const sqlBahanBarcode = `
    SELECT Kode, Nama, Satuan, Buffer, Masuk, Keluar, Stok
    FROM (
      SELECT
        LEFT(c.mst_brg_kode, LENGTH(c.mst_brg_kode) - 7) AS Kode,
        b.Bhn_Name   AS Nama,
        b.Bhn_satuan AS Satuan,
        b.bhn_buffer AS Buffer,
        SUM(c.mst_stok_in)                    AS Masuk,
        SUM(c.mst_stok_out)                   AS Keluar,
        SUM(c.mst_stok_in - c.mst_stok_out)   AS Stok
      FROM tmasterstok_barcode c
      LEFT JOIN tbahan b ON b.Bhn_kode = LEFT(c.mst_brg_kode, LENGTH(c.mst_brg_kode) - 7)
      WHERE c.mst_aktif = 'Y'
      GROUP BY LEFT(c.mst_brg_kode, LENGTH(c.mst_brg_kode) - 7),
              b.Bhn_Name, b.Bhn_satuan, b.bhn_buffer
    ) x
    WHERE x.Stok > 0 OR x.Stok < -0.1
    ORDER BY x.Stok DESC
    LIMIT 20
  `;

  const [
    [rowTotal],
    [rowBuffer],
    [rowBarcode],
    [rowMinus],
    [detailBawahBuffer],
    [topStok],
    [bahanBarcode],
  ] = await Promise.all([
    db.query(sqlTotalBahan),
    db.query(sqlBawahBuffer, [cabang]),
    db.query(sqlTotalBarcode),
    db.query(sqlBarcodeMinus),
    db.query(sqlDetailBawahBuffer, [cabang]),
    db.query(sqlTopStok, [cabang]),
    db.query(sqlBahanBarcode),
  ]);

  return {
    metric: {
      TotalJenis: rowTotal[0]?.TotalJenis || 0,
      JmlBawahBuffer: rowBuffer[0]?.JmlBawahBuffer || 0,
      TotalBarcode: rowBarcode[0]?.TotalBarcode || 0,
      JmlMinus: rowMinus[0]?.JmlMinus || 0,
    },
    detailBawahBuffer,
    topStok,
    bahanBarcode,
  };
};

const getGudangBahanBuffer = async (user, limit = 20, offset = 0) => {
  const bagian = (user.bagian || "").toUpperCase();
  const allowed = [
    "PEMBELIAN",
    "GUDANG",
    "PPIC",
    "FINANCE",
    "EDP",
    "IT",
    "DIREKSI",
    "OWNER",
    "AUDIT",
  ];
  if (!allowed.includes(bagian) && !isSuperViewer(user)) return [];

  const cabang = user.cabangGarmen || "P04";

  const sql = `
    SELECT Kode, Nama, Satuan, Buffer, StokAkhir
    FROM (
      SELECT
        b.brg_kode   AS Kode,
        IF(b.brg_note = '', b.brg_nama, CONCAT(b.brg_nama, ' - ', b.brg_note)) AS Nama,
        b.brg_satuan AS Satuan,
        b.brg_buffer AS Buffer,
        IFNULL(SUM(s.mst_stok_in - s.mst_stok_out), 0) AS StokAkhir
      FROM tgarmen_brg b
      LEFT JOIN tmasterstok_acc s ON s.mst_brg_kode = b.brg_kode
        AND s.mst_aktif = 'Y'
        AND s.mst_cab = ?
      WHERE b.brg_aktif = 'Y'
        AND b.brg_jenis = 'ACCESORIES'
        AND b.brg_buffer > 0
      GROUP BY b.brg_kode, b.brg_nama, b.brg_note, b.brg_satuan, b.brg_buffer
    ) x
    WHERE x.StokAkhir < x.Buffer
    ORDER BY (x.StokAkhir / x.Buffer) ASC
    LIMIT ? OFFSET ?
  `;

  const [rows] = await db.query(sql, [cabang, limit, offset]);
  return rows;
};

const getGudangBahanBarcode = async (user, limit = 20, offset = 0) => {
  const bagian = (user.bagian || "").toUpperCase();
  const allowed = [
    "PEMBELIAN",
    "GUDANG",
    "PPIC",
    "FINANCE",
    "EDP",
    "IT",
    "DIREKSI",
    "OWNER",
    "AUDIT",
  ];
  if (!allowed.includes(bagian) && !isSuperViewer(user)) return [];

  const sql = `
    SELECT Kode, Nama, Satuan, Buffer, Masuk, Keluar, Stok
    FROM (
      SELECT
        LEFT(c.mst_brg_kode, LENGTH(c.mst_brg_kode) - 7) AS Kode,
        b.Bhn_Name   AS Nama,
        b.Bhn_satuan AS Satuan,
        b.bhn_buffer AS Buffer,
        SUM(c.mst_stok_in)                  AS Masuk,
        SUM(c.mst_stok_out)                 AS Keluar,
        SUM(c.mst_stok_in - c.mst_stok_out) AS Stok
      FROM tmasterstok_barcode c
      LEFT JOIN tbahan b ON b.Bhn_kode = LEFT(c.mst_brg_kode, LENGTH(c.mst_brg_kode) - 7)
      WHERE c.mst_aktif = 'Y'
      GROUP BY LEFT(c.mst_brg_kode, LENGTH(c.mst_brg_kode) - 7),
               b.Bhn_Name, b.Bhn_satuan, b.bhn_buffer
    ) x
    WHERE x.Stok > 0 OR x.Stok < -0.1
    ORDER BY x.Stok DESC
    LIMIT ? OFFSET ?
  `;

  const [rows] = await db.query(sql, [limit, offset]);
  return rows;
};

module.exports = {
  getSpkUrgent,
  getPenawaranSummary,
  getPenawaranBelumSpk,
  getSpkSummary,
  getPoBahanSisa,
  getPoBahanVsBpbSummary,
  getPenawaranBelumMap,
  getPenawaranMapSummary,
  getKunjunganSalesSummary,
  getPiutangDashboard,
  getPiutangOverdue,
  getPenerimaanSummary,
  getGudangBahanDashboard,
  getGudangBahanBuffer,
  getGudangBahanBarcode,
};
