const db = require("../../config/database");
const outstandingPoMitraService = require("../laporan/gudang-garmen/outstandingPoMitraService");
const standartBabaranVsRealisasiService = require("../laporan/gudang-garmen/standartBabaranVsRealisasiService");
const stokAccVsMkaService = require("../laporan/gudang-garmen/stokAccVsMkaService");
const stokBarangJadiService = require("../laporan/gudang-garmen/stokBarangJadiService");
const mutasiStokBarangJadiService = require("../laporan/gudang-garmen/mutasiStokBarangJadiService");
const targetVsAchievementService = require("../laporan/marketing/targetVsAchievementService");
const rekapPenawaranService = require("../laporan/marketing/rekapPenawaranService");
const rekapMapService = require("../laporan/marketing/rekapMapService");
const proyeksiVsRealisasiService = require("../laporan/marketing/proyeksiVsRealisasiService");
const proyeksiBulananService = require("../laporan/marketing/proyeksiBulananService");

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

// ──────────────────────────────────────────────
// Ringkasan SO (Sales Order) — alur baru Marketing/MO, TERPISAH dari
// SPK (murni ranah produksi). Relasi 1:1 via so_spk_ref (index sudah
// ada: idx_so_spk_ref) — LEFT JOIN langsung ke tspk, bukan EXISTS/scan.
// ──────────────────────────────────────────────
const getSoSummary = async (user) => {
  const super_ = isSuperViewer(user);
  let whereExtra = "";
  if (!super_ && user.divisi) {
    whereExtra = `AND so.so_divisi = ${db.escape(String(user.divisi))}`;
  }
  const sql = `
    SELECT
      COUNT(*) AS TotalAktif,
      SUM(CASE WHEN so.so_spk_ref IS NULL OR so.so_spk_ref = ''
            THEN 1 ELSE 0 END) AS BelumSpk,
      SUM(CASE WHEN (so.so_jumlah - so.so_jumlah_kirim) > 0
            THEN 1 ELSE 0 END) AS BelumKirim,
      SUM(CASE WHEN so.so_spk_ref IS NOT NULL AND so.so_spk_ref <> ''
            AND IFNULL(s.spk_jumlah_jadi, 0) < so.so_jumlah
            THEN 1 ELSE 0 END) AS BelumJadi
    FROM tsalesorder so
    LEFT JOIN tspk s ON s.spk_nomor = so.so_spk_ref AND s.spk_aktif = 'Y'
    WHERE so.so_aktif = 'Y'
      AND so.so_close = 0
      AND so.so_tanggal >= '2024-01-01'
      ${whereExtra}
  `;
  const [rows] = await db.query(sql);
  return rows[0];
};

// ── SO Aktif — Trend Delta (minggu ini vs minggu lalu) ──
// Hitung SO baru terbit (so_tanggal) minggu ini vs minggu lalu.
// "Minggu ini" = 7 hari terakhir termasuk hari ini, "minggu lalu" =
// 7 hari sebelum itu.
const getSoAktifTrend = async (user) => {
  const super_ = isSuperViewer(user);
  let whereExtra = "";
  if (!super_ && user.divisi) {
    whereExtra = `AND so.so_divisi = ${db.escape(String(user.divisi))}`;
  }

  const sql = `
    SELECT
      SUM(CASE WHEN so.so_tanggal >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
            THEN 1 ELSE 0 END) AS MingguIni,
      SUM(CASE WHEN so.so_tanggal >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
            AND so.so_tanggal < DATE_SUB(CURDATE(), INTERVAL 6 DAY)
            THEN 1 ELSE 0 END) AS MingguLalu
    FROM tsalesorder so
    WHERE so.so_aktif = 'Y'
      AND so.so_tanggal >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
      ${whereExtra}
  `;
  const [rows] = await db.query(sql);
  const r = rows[0] || {};
  const mingguIni = Number(r.MingguIni) || 0;
  const mingguLalu = Number(r.MingguLalu) || 0;

  let delta = null; // null = tidak terbandingkan (minggu lalu 0)
  if (mingguLalu > 0) {
    delta = Math.round(((mingguIni - mingguLalu) / mingguLalu) * 10000) / 100;
  } else if (mingguIni === 0) {
    delta = 0;
  }

  return { mingguIni, mingguLalu, delta };
};

// ── PO Bahan dengan sisa MKB (seminggu terakhir) ──
const getPoBahanSisa = async (user) => {
  const bagian = (user.bagian || "").toUpperCase();
  // Hanya untuk bagian yang relevan
  const allowed = ["PEMBELIAN", "GUDANG", "PPIC"];
  if (!allowed.includes(bagian) && !isSuperViewer(user)) return null;

  const sql = `
    SELECT 
      COUNT(DISTINCT h.po_Nomor) AS TotalPO,
      SUM(
        CASE WHEN (
          SELECT MAX(
            d.pod_Jumlah 
            - IFNULL((SELECT SUM(mkbd_jumlah_PO) FROM tmkb_dtl WHERE mkbd_mkb_nomor = d.pod_mkb_nomor AND mkbd_bhn_kode = d.pod_bhn_kode), 0)
            - IFNULL((
                SELECT SUM(p.mkbd_jumlah_PO) 
                FROM tmkb_dtl2 o 
                JOIN tmkb_dtl p ON p.mkbd_mkb_nomor = o.mkbd2_mkb_nomor AND p.mkbd_nourut = o.mkbd2_nourut 
                WHERE o.mkbd2_po_nomor = d.pod_po_nomor AND o.mkbd2_pourut = d.pod_nourut
              ), 0)
          )
          FROM tpo_dtl d
          WHERE d.pod_po_nomor = h.po_Nomor
        ) > 0 THEN 1 ELSE 0 END
      ) AS PoAdaSisa
    FROM tpo_hdr h
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

// ══════════════════════════════════════════════
// DASHBOARD MARKETING — TAMBAHAN
// ══════════════════════════════════════════════

// 1. Achievement Ringkas — reuse getByDivisi + getBySales, filter Urut=1
const getAchievementSummary = async (user, tahun, bulanAwal, bulanAkhir) => {
  const bagian = (user.bagian || "").toUpperCase();
  if (!MARKETING_BAGIAN.includes(bagian) && !isSuperViewer(user)) return null;

  const thn = tahun || new Date().getFullYear();
  const bAwal = bulanAwal || new Date().getMonth() + 1;
  const bAkhir = bulanAkhir || new Date().getMonth() + 1;

  const [byDivisi, bySalesRaw] = await Promise.all([
    targetVsAchievementService.getByDivisi(thn, bAwal, bAkhir),
    targetVsAchievementService.getBySales(thn, bAwal, bAkhir),
  ]);

  const bySalesOnly = bySalesRaw.filter((r) => r.Urut === 1);
  const sortedByAch = [...bySalesOnly].sort(
    (a, b) => Number(b.Ach || 0) - Number(a.Ach || 0),
  );

  const totalTarget = byDivisi.reduce((s, r) => s + Number(r.Target || 0), 0);
  const totalRealisasi = byDivisi.reduce(
    (s, r) => s + Number(r.Realisasi || 0),
    0,
  );

  return {
    totalTarget,
    totalRealisasi,
    totalAch: totalTarget > 0 ? (totalRealisasi / totalTarget) * 100 : 0,
    byDivisi,
    topSales: sortedByAch.slice(0, 5),
    bottomSales: sortedByAch.slice(-5).reverse(),
  };
};

// 2. Growth YoY — reuse getSalesPerformance apa adanya
const getGrowthYoy = async (user, tahun) => {
  const bagian = (user.bagian || "").toUpperCase();
  if (!MARKETING_BAGIAN.includes(bagian) && !isSuperViewer(user)) return [];

  const thn = tahun || new Date().getFullYear();
  const rows = await targetVsAchievementService.getSalesPerformance(thn);
  return rows.map((r) => ({
    bulan: r.bulan,
    namaBulan: r.nama_bulan,
    aktual: Number(r.aktual) || 0,
    ly: Number(r.ly) || 0,
    yoy: Number(r.yoy) || 0,
    runAktual: Number(r.run_aktual) || 0,
    runYoy: Number(r.run_yoy) || 0,
    runGrowthPersen: Number(r.run_growth_persen) || 0,
    persenProyeksi: Number(r.persen_proyeksi) || 0,
  }));
};

// 3. Funnel Penawaran → Realisasi (+ Batal/Confirm), summarize per divisi
const getPenawaranFunnel = async (user, bulan, tahun) => {
  const bagian = (user.bagian || "").toUpperCase();
  if (!MARKETING_BAGIAN.includes(bagian) && !isSuperViewer(user)) return null;

  const rows = await rekapPenawaranService.getRekap({ bulan, tahun });

  const byDivisi = {};
  for (const r of rows) {
    const key = r.Divisi;
    if (!byDivisi[key]) {
      byDivisi[key] = {
        Divisi: key,
        JmlPenawaran: 0,
        Nominal: 0,
        Realisasi: 0,
        Batal: 0,
        Confirm: 0,
      };
    }
    byDivisi[key].JmlPenawaran += Number(r.JmlPenawaran || 0);
    byDivisi[key].Nominal += Number(r.Nominal || 0);
    byDivisi[key].Realisasi += Number(r.Realisasi || 0);
    byDivisi[key].Batal += Number(r.Batal || 0);
    byDivisi[key].Confirm += Number(r.Confirm || 0);
  }

  const result = Object.values(byDivisi).map((d) => ({
    ...d,
    PresentaseRealisasi:
      d.Nominal > 0 ? Math.round((d.Realisasi / d.Nominal) * 10000) / 100 : 0,
    PresentaseBatal:
      d.Nominal > 0 ? Math.round((d.Batal / d.Nominal) * 10000) / 100 : 0,
    PresentaseConfirm:
      d.Nominal > 0 ? Math.round((d.Confirm / d.Nominal) * 10000) / 100 : 0,
  }));

  const grandTotal = result.reduce(
    (acc, d) => ({
      Nominal: acc.Nominal + d.Nominal,
      Realisasi: acc.Realisasi + d.Realisasi,
      Batal: acc.Batal + d.Batal,
      Confirm: acc.Confirm + d.Confirm,
    }),
    { Nominal: 0, Realisasi: 0, Batal: 0, Confirm: 0 },
  );

  return { byDivisi: result, grandTotal };
};

// 4. Funnel MAP → Realisasi, summarize per divisi
const getMapFunnel = async (user, bulan, tahun) => {
  const bagian = (user.bagian || "").toUpperCase();
  if (!MARKETING_BAGIAN.includes(bagian) && !isSuperViewer(user)) return [];

  const rows = await rekapMapService.getRekap({ bulan, tahun });

  const byDivisi = {};
  for (const r of rows) {
    const key = r.Divisi;
    if (!byDivisi[key]) {
      byDivisi[key] = { Divisi: key, JmlMAP: 0, Nominal: 0, Realisasi: 0 };
    }
    byDivisi[key].JmlMAP += Number(r.JmlMAP || 0);
    byDivisi[key].Nominal += Number(r.Nominal || 0);
    byDivisi[key].Realisasi += Number(r.Realisasi || 0);
  }

  return Object.values(byDivisi).map((d) => ({
    ...d,
    Presentase:
      d.Nominal > 0 ? Math.round((d.Realisasi / d.Nominal) * 10000) / 100 : 0,
  }));
};

// 5. Proyeksi vs Realisasi — reuse getBrowse, summarize + top-N gap customer
const getProyeksiVsRealisasiSummary = async (
  user,
  startDate,
  endDate,
  page = 1,
  limit = 20,
) => {
  const bagian = (user.bagian || "").toUpperCase();
  if (!MARKETING_BAGIAN.includes(bagian) && !isSuperViewer(user)) return null;

  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  const rows = await proyeksiVsRealisasiService.getBrowse(dStart, dEnd);

  const totalMemo = rows.reduce((s, r) => s + (r.TotalMemo || 0), 0);
  const totalRealisasiMemo = rows.reduce(
    (s, r) => s + (r.RealisasiMemo || 0),
    0,
  );
  const totalRealisasiAll = rows.reduce((s, r) => s + (r.RealisasiAll || 0), 0);

  const withGap = rows
    .map((r) => ({
      CusKode: r.CUS_KODE ?? r.CusKode,
      CusNama: r.CUS_NAMA ?? r.CusNama,
      JoKode: r.JO_KODE ?? r.JoKode,
      JoNama: r.JO_NAMA ?? r.JoNama,
      TotalMemo: r.TotalMemo || r.TOTAL_MEMO || 0,
      RealisasiMemo: r.RealisasiMemo ?? r.REALISASI_MEMO ?? null,
      gap:
        (r.TotalMemo || r.TOTAL_MEMO || 0) -
        (r.RealisasiMemo || r.REALISASI_MEMO || 0),
    }))
    .filter((r) => r.gap > 0)
    .sort((a, b) => b.gap - a.gap);

  const start = (page - 1) * limit;
  const paged = withGap.slice(start, start + limit);

  return {
    totalMemo,
    totalRealisasiMemo,
    totalRealisasiAll,
    gapCustomer: paged,
    totalGapCount: withGap.length,
    hasMore: start + limit < withGap.length,
  };
};

// 6. Pipeline Menggantung (Memo belum SPK + Penawaran belum Memo/SPK) —
// reuse getProyeksi mode 1
const getPipelineMenggantung = async (
  user,
  startDate,
  endDate,
  page = 1,
  limit = 20,
) => {
  const bagian = (user.bagian || "").toUpperCase();
  if (!MARKETING_BAGIAN.includes(bagian) && !isSuperViewer(user)) return null;

  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  const rows = await proyeksiBulananService.getProyeksi(dStart, dEnd);
  const totalNilai = rows.reduce((s, r) => s + Number(r.Jumlah || 0), 0);
  const sorted = [...rows].sort(
    (a, b) => Number(b.Jumlah || 0) - Number(a.Jumlah || 0),
  );

  const start = (page - 1) * limit;
  const paged = sorted.slice(start, start + limit).map((r) => ({
    Customer: r.Customer,
    NamaSpk: r.NamaSpk,
    Sales: r.Sales,
    Divisi: r.Divisi,
    Jumlah: Number(r.Jumlah) || 0,
  }));

  return {
    totalItem: rows.length,
    totalNilai,
    items: paged,
    hasMore: start + limit < sorted.length,
  };
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

// Ganti subquery `spk` (LEFT JOIN ke tspk) yang muncul di 4 tempat
// (sqlMetric, sqlTren, sqlDistribusi di getRealisasiPenawaranDashboard,
// dan sqlDetail di getRealisasiPenawaranDetail) dengan versi UNION
// tspk + tsalesorder ini — nama alias di query luar TETAP "spk"
// (gak perlu ganti nama alias-nya), cukup isi definisinya diganti.
const REALISASI_SUBQUERY_DEF = `
  SELECT
    pen_nomor,
    COUNT(*)                          AS TotalSPK,
    MIN(nomor_realisasi)              AS SpkPertama,
    MIN(tgl_realisasi)                AS TglSpkPertama,
    DATEDIFF(MIN(tgl_realisasi), MIN(tgl_pen)) AS HariKonversi
  FROM (
    SELECT s.spk_pen_nomor AS pen_nomor, s.spk_nomor AS nomor_realisasi,
           s.spk_tanggal AS tgl_realisasi, h2.pen_tanggal AS tgl_pen
    FROM tspk s
    INNER JOIN tpenawaran_hdr h2 ON h2.pen_nomor = s.spk_pen_nomor
    WHERE s.spk_aktif = 'Y' AND s.spk_pen_nomor IS NOT NULL AND s.spk_pen_nomor <> ''
    UNION ALL
    SELECT so.so_pen_nomor AS pen_nomor, so.so_nomor AS nomor_realisasi,
           so.so_tanggal AS tgl_realisasi, h3.pen_tanggal AS tgl_pen
    FROM tsalesorder so
    INNER JOIN tpenawaran_hdr h3 ON h3.pen_nomor = so.so_pen_nomor
    WHERE so.so_aktif = 'Y' AND so.so_pen_nomor IS NOT NULL AND so.so_pen_nomor <> ''
  ) u
  GROUP BY pen_nomor
`;

// ── Dashboard Realisasi Penawaran ──
const getRealisasiPenawaranDashboard = async (user) => {
  const bagian = (user.bagian || "").toUpperCase();
  const MARKETING_BAGIAN = [
    "MARKETING",
    "EDP",
    "DIREKSI",
    "OWNER",
    "IT",
    "FINANCE",
    "AUDIT",
  ];
  if (!MARKETING_BAGIAN.includes(bagian) && !isSuperViewer(user)) return null;

  let whereExtra = "";
  if (!isSuperViewer(user) && user.divisi) {
    whereExtra = `AND h.pen_divisi = ${db.escape(String(user.divisi))}`;
  }

  const sqlMetric = `
    SELECT
      COUNT(DISTINCT h.pen_nomor) AS TotalPenawaran,
      COUNT(DISTINCT CASE WHEN spk.HariKonversi IS NOT NULL AND spk.HariKonversi <= 7
            THEN h.pen_nomor END) AS KonversiCepat,
      COUNT(DISTINCT CASE WHEN spk.HariKonversi IS NOT NULL AND spk.HariKonversi BETWEEN 8 AND 30
            THEN h.pen_nomor END) AS KonversiNormal,
      COUNT(DISTINCT CASE WHEN spk.HariKonversi IS NOT NULL AND spk.HariKonversi BETWEEN 31 AND 90
            THEN h.pen_nomor END) AS KonversiLambat,
      COUNT(DISTINCT CASE WHEN spk.HariKonversi IS NOT NULL AND spk.HariKonversi > 90
            THEN h.pen_nomor END) AS KonversiSangatLambat,
      COUNT(DISTINCT CASE WHEN spk.HariKonversi IS NULL
            THEN h.pen_nomor END) AS BelumKonversi,
      ROUND(AVG(spk.HariKonversi), 1) AS RataRataHari
    FROM tpenawaran_hdr h
    LEFT JOIN (${REALISASI_SUBQUERY_DEF}) spk ON spk.pen_nomor = h.pen_nomor
    WHERE h.pen_tanggal >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
      AND h.pen_tanggal <= CURDATE()
      ${whereExtra}
  `;

  const sqlTren = `
    SELECT
      DATE_FORMAT(h.pen_tanggal, '%Y-%m') AS Bulan,
      COUNT(DISTINCT h.pen_nomor) AS TotalPenawaran,
      COUNT(DISTINCT CASE WHEN spk.HariKonversi IS NOT NULL THEN h.pen_nomor END) AS Konversi,
      ROUND(AVG(spk.HariKonversi), 1) AS RataRataHari
    FROM tpenawaran_hdr h
    LEFT JOIN (${REALISASI_SUBQUERY_DEF}) spk ON spk.pen_nomor = h.pen_nomor
    WHERE h.pen_tanggal >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 5 MONTH), '%Y-%m-01')
      AND h.pen_tanggal <= CURDATE()
      ${whereExtra}
    GROUP BY DATE_FORMAT(h.pen_tanggal, '%Y-%m')
    ORDER BY Bulan ASC
  `;

  const sqlDistribusi = `
    SELECT
      CASE
        WHEN spk.HariKonversi <= 7              THEN 'Cepat'
        WHEN spk.HariKonversi BETWEEN 8 AND 30  THEN 'Normal'
        WHEN spk.HariKonversi BETWEEN 31 AND 90 THEN 'Lambat'
        WHEN spk.HariKonversi > 90              THEN 'Sangat Lambat'
        ELSE 'Belum SPK'
      END AS Bucket,
      COUNT(DISTINCT h.pen_nomor) AS Jumlah
    FROM tpenawaran_hdr h
    LEFT JOIN (
      SELECT
        spk_pen_nomor,
        DATEDIFF(MIN(spk_tanggal), MIN(h2.pen_tanggal)) AS HariKonversi
      FROM tspk s
      INNER JOIN tpenawaran_hdr h2 ON h2.pen_nomor = s.spk_pen_nomor
      WHERE s.spk_aktif = 'Y'
        AND s.spk_pen_nomor IS NOT NULL
        AND s.spk_pen_nomor <> ''
      GROUP BY s.spk_pen_nomor
    ) spk ON spk.spk_pen_nomor = h.pen_nomor
    WHERE h.pen_tanggal >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
      AND h.pen_tanggal <= CURDATE()
      ${whereExtra}
    GROUP BY Bucket
    ORDER BY FIELD(Bucket, 'Cepat', 'Normal', 'Lambat', 'Sangat Lambat', 'Belum SPK')
  `;

  const [[metric], [tren], [distribusi]] = await Promise.all([
    db.query(sqlMetric),
    db.query(sqlTren),
    db.query(sqlDistribusi),
  ]);

  return { metric: metric[0] || {}, tren, distribusi };
};

const getRealisasiPenawaranDetail = async (user, limit = 20, offset = 0) => {
  const bagian = (user.bagian || "").toUpperCase();
  const MARKETING_BAGIAN = [
    "MARKETING",
    "EDP",
    "DIREKSI",
    "OWNER",
    "IT",
    "FINANCE",
    "AUDIT",
  ];
  if (!MARKETING_BAGIAN.includes(bagian) && !isSuperViewer(user)) return [];

  let whereExtra = "";
  if (!isSuperViewer(user) && user.divisi) {
    whereExtra = `AND h.pen_divisi = ${db.escape(String(user.divisi))}`;
  }

  const sql = `
    SELECT
      h.pen_nomor                                AS NomorPenawaran,
      DATE_FORMAT(h.pen_tanggal, '%d-%m-%Y')     AS TglPenawaran,
      c.cus_nama                                 AS Customer,
      IFNULL(spk.TotalSPK, 0)                    AS TotalSPK,
      spk.SpkPertama,
      DATE_FORMAT(spk.TglSpkPertama, '%d-%m-%Y') AS TglSpkPertama,
      spk.HariKonversi
    FROM tpenawaran_hdr h
    INNER JOIN tcustomer c ON c.cus_kode = h.pen_cus_kode
    LEFT JOIN (${REALISASI_SUBQUERY_DEF}) spk ON spk.pen_nomor = h.pen_nomor
    WHERE h.pen_tanggal >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
      AND h.pen_tanggal <= CURDATE()
      ${whereExtra}
    ORDER BY h.pen_tanggal DESC
    LIMIT ? OFFSET ?
  `;

  const [rows] = await db.query(sql, [limit, offset]);
  return rows;
};

// ── Dashboard MAP vs SPK (summary + nilai per divisi) ──
const getMapVsSpkDashboard = async (user, startDate, endDate) => {
  const bagian = (user.bagian || "").toUpperCase();
  if (!MARKETING_BAGIAN.includes(bagian) && !isSuperViewer(user)) return null;
  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);
  const paramsMetric = [dStart, dEnd];
  const paramsDivisi = [dStart, dEnd];
  let whereExtra = "";
  if (!isSuperViewer(user) && user.divisi) {
    whereExtra = "AND m.mspk_divisi = ?";
    paramsMetric.push(String(user.divisi));
    paramsDivisi.push(String(user.divisi));
  }
  // Konversi MAP dicek ke DUA sumber: tspk (SPK format lama) DAN
  // tsalesorder (SO baru) — MAP yg sudah jadi SO tetap dihitung
  // "sudah" (bukan lagi "belum"), sesuai migrasi SO.
  const sqlMetric = `
    SELECT
      COUNT(DISTINCT m.mspk_nomor) AS TotalMAP,
      COUNT(DISTINCT CASE WHEN COALESCE(spk.nomor, so.nomor) IS NOT NULL THEN m.mspk_nomor END) AS SudahSO,
      COUNT(DISTINCT CASE WHEN COALESCE(spk.nomor, so.nomor) IS NULL THEN m.mspk_nomor END) AS BelumSO,
      IFNULL(SUM(IF(COALESCE(spk.nomor, so.nomor) IS NOT NULL,
            IFNULL(spk.nilai, so.nilai),
            m.mspk_harga  * m.mspk_rencana_order)), 0) AS TotalNilai,
      IFNULL(SUM(CASE WHEN COALESCE(spk.nomor, so.nomor) IS NOT NULL
            THEN IFNULL(spk.nilai, so.nilai) ELSE 0 END), 0) AS NilaiSudahSO,
      IFNULL(SUM(CASE WHEN COALESCE(spk.nomor, so.nomor) IS NULL
            THEN m.mspk_harga * m.mspk_rencana_order ELSE 0 END), 0) AS NilaiBelumSO
    FROM tmemospk m
    INNER JOIN tcustomer c ON c.cus_kode = m.mspk_cus_kode
    LEFT JOIN (
      SELECT spk_memo, spk_nomor AS nomor, spk_harga * spk_jumlah AS nilai
      FROM tspk WHERE spk_aktif = 'Y'
    ) spk ON spk.spk_memo = m.mspk_nomor
    LEFT JOIN (
      SELECT so_memo, so_nomor AS nomor, so_harga * so_jumlah AS nilai
      FROM tsalesorder WHERE so_aktif = 'Y'
    ) so ON so.so_memo = m.mspk_nomor
    WHERE m.mspk_tanggal >= ? AND m.mspk_tanggal <= ?
    ${whereExtra}
  `;
  const sqlDivisi = `
    SELECT Divisi, TotalMAP, SudahSO, NilaiSO, NilaiPotensi
    FROM (
      SELECT
        IFNULL(d.Divisi, 'LAINNYA') AS Divisi,
        COUNT(DISTINCT m.mspk_nomor) AS TotalMAP,
        COUNT(DISTINCT CASE WHEN COALESCE(spk.nomor, so.nomor) IS NOT NULL THEN m.mspk_nomor END) AS SudahSO,
        IFNULL(SUM(CASE WHEN COALESCE(spk.nomor, so.nomor) IS NOT NULL
              THEN IFNULL(spk.nilai, so.nilai) ELSE 0 END), 0) AS NilaiSO,
        IFNULL(SUM(CASE WHEN COALESCE(spk.nomor, so.nomor) IS NULL
              THEN m.mspk_harga * m.mspk_rencana_order ELSE 0 END), 0) AS NilaiPotensi
      FROM tmemospk m
      LEFT JOIN tdivisi d ON d.kode = m.mspk_divisi
      LEFT JOIN (
        SELECT spk_memo, spk_nomor AS nomor, spk_harga * spk_jumlah AS nilai
        FROM tspk WHERE spk_aktif = 'Y'
      ) spk ON spk.spk_memo = m.mspk_nomor
      LEFT JOIN (
        SELECT so_memo, so_nomor AS nomor, so_harga * so_jumlah AS nilai
        FROM tsalesorder WHERE so_aktif = 'Y'
      ) so ON so.so_memo = m.mspk_nomor
      WHERE m.mspk_tanggal >= ? AND m.mspk_tanggal <= ?
      ${whereExtra}
      GROUP BY m.mspk_divisi, d.Divisi
    ) x
    ORDER BY (x.NilaiSO + x.NilaiPotensi) DESC
  `;
  const [[metricRows], [divisiRows]] = await Promise.all([
    db.query(sqlMetric, paramsMetric),
    db.query(sqlDivisi, paramsDivisi),
  ]);
  return { metric: metricRows[0] || {}, divisi: divisiRows };
};

const getMapBelumSo = async (
  user,
  limit = 20,
  offset = 0,
  startDate,
  endDate,
) => {
  const bagian = (user.bagian || "").toUpperCase();
  if (!MARKETING_BAGIAN.includes(bagian) && !isSuperViewer(user)) return [];
  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);
  const params = [dStart, dEnd];
  let whereExtra = "";
  if (!isSuperViewer(user) && user.divisi) {
    whereExtra = "AND m.mspk_divisi = ?";
    params.push(String(user.divisi));
  }
  params.push(limit, offset);
  const sql = `
    SELECT
      m.mspk_nomor                             AS Nomor,
      DATE_FORMAT(m.mspk_tanggal, '%d-%m-%Y') AS Tanggal,
      IFNULL(dv.Divisi, '-')                   AS Divisi,
      c.cus_nama                               AS NamaCustomer,
      m.mspk_nama                              AS NamaMAP,
      m.mspk_jumlah                            AS Jumlah,
      m.mspk_harga * m.mspk_rencana_order      AS NilaiPotensi,
      DATEDIFF(CURDATE(), m.mspk_tanggal)      AS UmurHari
    FROM tmemospk m
    INNER JOIN tcustomer c  ON c.cus_kode = m.mspk_cus_kode
    LEFT  JOIN tdivisi dv   ON dv.kode = m.mspk_divisi
    WHERE m.mspk_tanggal >= ? AND m.mspk_tanggal <= ?
    ${whereExtra}
      AND NOT EXISTS (
        SELECT 1 FROM tspk s
        WHERE s.spk_memo = m.mspk_nomor AND s.spk_aktif = 'Y'
      )
      AND NOT EXISTS (
        SELECT 1 FROM tsalesorder so
        WHERE so.so_memo = m.mspk_nomor AND so.so_aktif = 'Y'
      )
    ORDER BY m.mspk_tanggal ASC
    LIMIT ? OFFSET ?
  `;
  const [rows] = await db.query(sql, params);
  return rows;
};

const getMapVsSjDashboard = async (user, startDate, endDate) => {
  const bagian = (user.bagian || "").toUpperCase();
  if (!MARKETING_BAGIAN.includes(bagian) && !isSuperViewer(user)) return null;

  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  const params = [dStart, dEnd];
  let whereExtra = "";
  if (!isSuperViewer(user) && user.divisi) {
    whereExtra = "AND m.mspk_divisi = ?";
    params.push(String(user.divisi));
  }

  const sql = `
    SELECT
      COUNT(DISTINCT m.mspk_nomor) AS TotalMAP,
      COUNT(DISTINCT CASE WHEN IFNULL(sj.TotalKirim, 0) = 0
            THEN m.mspk_nomor END) AS BelumKirim,
      COUNT(DISTINCT CASE WHEN IFNULL(sj.TotalKirim, 0) > 0
            AND IFNULL(sj.TotalKirim, 0) < m.mspk_jumlah
            THEN m.mspk_nomor END) AS SebagianKirim,
      COUNT(DISTINCT CASE WHEN IFNULL(sj.TotalKirim, 0) >= m.mspk_jumlah
            THEN m.mspk_nomor END) AS LunasKirim,
      IFNULL(SUM(m.mspk_jumlah), 0)               AS TotalQtyOrder,
      IFNULL(SUM(IFNULL(sj.TotalKirim, 0)), 0)     AS TotalQtyKirim
    FROM tmemospk m
    LEFT JOIN (
      SELECT d.sjd_mspk_nomor, SUM(d.sjd_jumlah) AS TotalKirim
      FROM tsj_dtl_memo d
      INNER JOIN tsj_hdr_memo h ON h.sj_nomor = d.sjd_sj_nomor
      GROUP BY d.sjd_mspk_nomor
    ) sj ON sj.sjd_mspk_nomor = m.mspk_nomor
    WHERE m.mspk_tanggal >= ? AND m.mspk_tanggal <= ?
    ${whereExtra}
  `;

  const [rows] = await db.query(sql, params);
  return rows[0] || {};
};

const getMapBelumKirim = async (
  user,
  limit = 20,
  offset = 0,
  startDate,
  endDate,
) => {
  const bagian = (user.bagian || "").toUpperCase();
  if (!MARKETING_BAGIAN.includes(bagian) && !isSuperViewer(user)) return [];

  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  const params = [dStart, dEnd];
  let whereExtra = "";
  if (!isSuperViewer(user) && user.divisi) {
    whereExtra = "AND m.mspk_divisi = ?";
    params.push(String(user.divisi));
  }
  params.push(limit, offset);

  const sql = `
    SELECT
      m.mspk_nomor                             AS Nomor,
      DATE_FORMAT(m.mspk_tanggal, '%d-%m-%Y') AS Tanggal,
      IFNULL(dv.Divisi, '-')                   AS Divisi,
      c.cus_nama                               AS NamaCustomer,
      m.mspk_nama                              AS NamaMAP,
      m.mspk_jumlah                            AS QtyOrder,
      IFNULL(sj.TotalKirim, 0)                 AS QtyKirim,
      DATE_FORMAT(m.mspk_dateline, '%d-%m-%Y') AS Dateline
    FROM tmemospk m
    INNER JOIN tcustomer c ON c.cus_kode = m.mspk_cus_kode
    LEFT  JOIN tdivisi dv  ON dv.kode = m.mspk_divisi
    LEFT  JOIN (
      SELECT d.sjd_mspk_nomor, SUM(d.sjd_jumlah) AS TotalKirim
      FROM tsj_dtl_memo d
      INNER JOIN tsj_hdr_memo h ON h.sj_nomor = d.sjd_sj_nomor
      GROUP BY d.sjd_mspk_nomor
    ) sj ON sj.sjd_mspk_nomor = m.mspk_nomor
    WHERE m.mspk_tanggal >= ? AND m.mspk_tanggal <= ?
    ${whereExtra}
      AND IFNULL(sj.TotalKirim, 0) < m.mspk_jumlah
    ORDER BY m.mspk_tanggal ASC
    LIMIT ? OFFSET ?
  `;

  const [rows] = await db.query(sql, params);
  return rows;
};

const getSpkBelumMkbCount = async (user) => {
  const bagian = (user.bagian || "").toUpperCase();
  // Hanya relevan untuk PEMBELIAN dan super viewer
  const allowed = [
    "PEMBELIAN",
    "PPIC",
    "GUDANG",
    "EDP",
    "IT",
    "DIREKSI",
    "OWNER",
    "AUDIT",
  ];
  if (!allowed.includes(bagian) && !isSuperViewer(user)) return 0;

  const sql = `
    SELECT COUNT(*) AS Total
    FROM tspk s
    WHERE s.spk_aktif = 'Y'
      AND s.spk_close = 0
      AND s.spk_cmo <> ''
      AND s.spk_jo_kode NOT IN ('BR', 'SB', 'SD', 'PL')
      AND s.spk_divisi IN (3, 4, 6)
      AND s.spk_nomor NOT IN (
        SELECT h.MKB_SPK_NOMOR
        FROM tmkb_hdr h
        WHERE h.MKB_SPK_NOMOR <> ''
      )
      AND s.spk_tanggal >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
  `;

  const [rows] = await db.query(sql);
  return rows[0]?.Total || 0;
};

// ── 2. Aktivitas Hari Ini (SPK baru + SO baru + MAP baru + SJ baru + penawaran baru + invoice baru) ──
const getAktivitasHariIni = async (limit = 20, offset = 0) => {
  const sql = `
    SELECT * FROM (
      SELECT
        'SPK' AS jenis,
        s.spk_nomor AS nomor,
        s.spk_nama AS nama,
        d.divisi AS divisi,
        DATE_FORMAT(s.date_create, '%H:%i') AS jam,
        s.date_create AS waktu
      FROM tspk s
      LEFT JOIN tdivisi d ON d.kode = s.spk_divisi
      WHERE s.date_create >= CURDATE() AND s.date_create < CURDATE() + INTERVAL 1 DAY
        AND s.spk_aktif = 'Y'

      UNION ALL

      SELECT
        'SO' AS jenis,
        so.so_nomor AS nomor,
        so.so_nama AS nama,
        d.divisi AS divisi,
        DATE_FORMAT(so.date_create, '%H:%i') AS jam,
        so.date_create AS waktu
      FROM tsalesorder so
      LEFT JOIN tdivisi d ON d.kode = so.so_divisi
      WHERE so.date_create >= CURDATE() AND so.date_create < CURDATE() + INTERVAL 1 DAY
        AND so.so_aktif = 'Y'

      UNION ALL

      SELECT
        'MAP' AS jenis,
        m.mspk_nomor AS nomor,
        m.mspk_nama AS nama,
        d.divisi AS divisi,
        DATE_FORMAT(m.date_create, '%H:%i') AS jam,
        m.date_create AS waktu
      FROM tmemospk m
      LEFT JOIN tdivisi d ON d.kode = m.mspk_divisi
      WHERE m.date_create >= CURDATE() AND m.date_create < CURDATE() + INTERVAL 1 DAY
        AND m.mspk_aktif = 'Y'

      UNION ALL

      SELECT
        'SJ' AS jenis,
        h.sj_nomor AS nomor,
        h.sj_keterangan AS nama,
        d.divisi AS divisi,
        DATE_FORMAT(h.date_create, '%H:%i') AS jam,
        h.date_create AS waktu
      FROM tsj_hdr h
      LEFT JOIN tdivisi d ON d.kode = h.sj_divisi
      WHERE h.date_create >= CURDATE() AND h.date_create < CURDATE() + INTERVAL 1 DAY

      UNION ALL

      SELECT
        'PENAWARAN' AS jenis,
        h.pen_nomor AS nomor,
        h.pen_keterangan AS nama,
        d.divisi AS divisi,
        DATE_FORMAT(h.date_create, '%H:%i') AS jam,
        h.date_create AS waktu
      FROM tpenawaran_hdr h
      LEFT JOIN tdivisi d ON d.kode = h.pen_divisi
      WHERE h.date_create >= CURDATE() AND h.date_create < CURDATE() + INTERVAL 1 DAY

      UNION ALL

      -- [FIX] OR di sini beda kasus dari OR-join sebelumnya: ini OR di WHERE
      -- antar 2 kolom pada tabel yang sama, MariaDB bisa index_merge selama
      -- masing-masing kolom sargable & ada index sendiri-sendiri.
      SELECT
        'INVOICE' AS jenis,
        a.inv_nomor AS nomor,
        a.inv_keterangan AS nama,
        p.perush_nama AS divisi,
        DATE_FORMAT(IFNULL(a.date_create, a.inv_tanggal), '%H:%i') AS jam,
        IFNULL(a.date_create, a.inv_tanggal) AS waktu
      FROM tinv_hdr a
      LEFT JOIN tperusahaan p ON p.perush_kode = a.inv_perush_kode
      WHERE (
          (a.inv_tanggal >= CURDATE() AND a.inv_tanggal < CURDATE() + INTERVAL 1 DAY)
          OR
          (a.date_create >= CURDATE() AND a.date_create < CURDATE() + INTERVAL 1 DAY)
        )
        AND a.inv_status_otomatis <> 1
    ) akt
    ORDER BY waktu DESC
    LIMIT ? OFFSET ?
  `;
  const [rows] = await db.query(sql, [limit, offset]);
  return rows;
};

const getAktivitasHariIniCount = async () => {
  const sql = `
    SELECT SUM(cnt) AS total FROM (
      SELECT COUNT(*) AS cnt FROM tspk
        WHERE (DATE(spk_tanggal) = CURDATE() OR DATE(date_create) = CURDATE()) AND spk_aktif = 'Y'
      UNION ALL
      SELECT COUNT(*) FROM tsalesorder
        WHERE (DATE(so_tanggal) = CURDATE() OR DATE(date_create) = CURDATE()) AND so_aktif = 'Y'
      UNION ALL
      SELECT COUNT(*) FROM tmemospk
        WHERE (DATE(mspk_tanggal) = CURDATE() OR DATE(date_create) = CURDATE()) AND mspk_aktif = 'Y'
      UNION ALL
      SELECT COUNT(*) FROM tsj_hdr WHERE DATE(date_create) = CURDATE()
      UNION ALL
      SELECT COUNT(*) FROM tpenawaran_hdr WHERE DATE(date_create) = CURDATE()
      UNION ALL
      SELECT COUNT(*) FROM tinv_hdr
        WHERE (DATE(inv_tanggal) = CURDATE() OR DATE(date_create) = CURDATE()) AND inv_status_otomatis <> 1
    ) x
  `;
  const [rows] = await db.query(sql);
  return Number(rows[0]?.total || 0);
};

// ── 3. Trend SPK vs SO vs MAP, 7 hari terakhir (untuk C3 chart) ──
const getTrendSpk7Hari = async () => {
  const sql = `
    SELECT
      DATE_FORMAT(tgl, '%d/%m')   AS label,
      IFNULL(spk_baru, 0)         AS spk_baru,
      IFNULL(so_baru, 0)          AS so_baru,
      IFNULL(map_baru, 0)         AS map_baru
    FROM (
      SELECT DATE_SUB(CURDATE(), INTERVAL n DAY) AS tgl
      FROM (
        SELECT 0 n UNION SELECT 1 UNION SELECT 2 UNION SELECT 3
        UNION SELECT 4 UNION SELECT 5 UNION SELECT 6
      ) nums
    ) dates
    LEFT JOIN (
      SELECT DATE(spk_tanggal) AS tgl_spk, COUNT(*) AS spk_baru
      FROM tspk
      WHERE spk_tanggal >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
        AND spk_aktif = 'Y'
      GROUP BY DATE(spk_tanggal)
    ) s ON s.tgl_spk = dates.tgl
    LEFT JOIN (
      SELECT DATE(so_tanggal) AS tgl_so, COUNT(*) AS so_baru
      FROM tsalesorder
      WHERE so_tanggal >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
        AND so_aktif = 'Y'
      GROUP BY DATE(so_tanggal)
    ) so ON so.tgl_so = dates.tgl
    LEFT JOIN (
      SELECT DATE(mspk_tanggal) AS tgl_map, COUNT(*) AS map_baru
      FROM tmemospk
      WHERE mspk_tanggal >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
        AND mspk_aktif = 'Y'
      GROUP BY DATE(mspk_tanggal)
    ) m ON m.tgl_map = dates.tgl
    ORDER BY tgl ASC
  `;
  const [rows] = await db.query(sql);
  return rows;
};

const getApprovalPendingCount = async () => {
  const sql = `
    SELECT
      (SELECT COUNT(*) FROM tcustomer_pin 
       WHERE cusp_acc = '') AS piutang,

      (SELECT COUNT(*) FROM tspk_pin 
       WHERE pin_acc = '') AS harga_nol,

      (SELECT COUNT(*) FROM tspk_pin_prioritas 
       WHERE pin_acc = '') AS prioritas,

      (SELECT COUNT(*) FROM tapprove 
       WHERE pin_jenis = 'INVBLMSJ' AND pin_acc = '') AS inv_blm_sj,

      (SELECT COUNT(*) FROM tspk_pin5 
       WHERE pin_jenis = 'UBAH' AND pin_acc = '' AND pin_dipakai = '') AS perubahan,

      (SELECT COUNT(*) FROM tspk_pin5 
       WHERE pin_jenis = 'HAPUS' AND pin_acc = '' AND pin_dipakai = '') AS hapus,

      (SELECT COUNT(*) FROM tcustomer 
       WHERE cus_plafon_acc IN ('PENDING_MANAGER', 'PENDING_DIREKSI')) AS plafon
  `;
  const [rows] = await db.query(sql);
  return rows[0];
};

// ── Pipeline SPK → Produksi (funnel), filter by spk_dateline ──
const getPipelineSpkProduksi = async (user, startDate, endDate) => {
  const bagian = (user.bagian || "").toUpperCase();
  const allowed = ["PEMBELIAN", "GUDANG", "PPIC"];
  if (!allowed.includes(bagian) && !isSuperViewer(user)) return null;

  let whereExtra = "";
  const params = [startDate, endDate];
  if (!isSuperViewer(user) && user.divisi) {
    whereExtra = "AND s.spk_divisi = ?";
    params.push(String(user.divisi));
  }

  const sql = `
    SELECT
      COUNT(DISTINCT s.spk_nomor) AS TotalMasuk,
      COUNT(DISTINCT CASE WHEN EXISTS (
        SELECT 1 FROM tmkb_hdr k WHERE k.MKB_SPK_NOMOR = s.spk_nomor
      ) THEN s.spk_nomor END) AS AdaMkb,
      COUNT(DISTINCT CASE WHEN EXISTS (
        SELECT 1 FROM tproduksiminta_hdr h WHERE h.promin_spk_nomor = s.spk_nomor
      ) THEN s.spk_nomor END) AS AdaRealisasi,
      COUNT(DISTINCT CASE WHEN EXISTS (
        SELECT 1 FROM tmutasiproduksi_hdr h
        WHERE h.mph_spk_nomor = s.spk_nomor
          AND (h.mph_gdgasal = 'GP001' OR h.mph_gdgasal = 'GP015')
          AND h.mph_nomaterial <> ''
      ) THEN s.spk_nomor END) AS AdaLhk,
      COUNT(DISTINCT CASE WHEN EXISTS (
        SELECT 1 FROM tstbj_dtl d WHERE d.STBJD_SPK_Nomor = s.spk_nomor
      ) THEN s.spk_nomor END) AS AdaStbj,
      COUNT(DISTINCT CASE WHEN EXISTS (
        SELECT 1 FROM tsj_dtl d WHERE d.sjd_spk_nomor = s.spk_nomor
      ) THEN s.spk_nomor END) AS AdaKirim
    FROM tspk s
    WHERE s.spk_aktif = 'Y'
      AND s.spk_divisi IN (3, 4, 6)
      AND s.spk_dateline >= ? AND s.spk_dateline <= ?
      ${whereExtra}
  `;

  const [rows] = await db.query(sql, params);
  return rows[0] || {};
};

// ── Bahan Kurang — base query SEKARANG termasuk detail per bahan
// (Kode, NamaBahan, Satuan), bukan cuma agregat SPK ──
const bahanKurangBaseQuery = `
  SELECT
    IFNULL(sp.spk_nomor, mm.mspk_nomor) AS Nomor,
    IFNULL(sp.spk_nama, mm.mspk_nama) AS NamaSpk,
    d.mkbd_bhn_kode AS Kode,
    b.Bhn_Name AS NamaBahan,
    b.Bhn_satuan AS Satuan,
    (d.mkbd_jumlah - (
      d.mkbd_jumlah_RS +
      IFNULL((
        SELECT SUM(dd.bpbd_Jumlah) FROM tbpb_dtl dd
        INNER JOIN tbpb_hdr hh ON hh.bpb_Nomor = dd.bpbd_bpb_Nomor
        WHERE hh.bpb_po_Nomor = i.pod_po_Nomor AND dd.bpbd_bhn_kode = i.pod_bhn_kode
      ), 0) +
      IFNULL((
        SELECT SUM(dd.bpbd_Jumlah) FROM tbpb_dtl dd
        INNER JOIN tbpb_hdr hh ON hh.bpb_Nomor = dd.bpbd_bpb_Nomor
        WHERE hh.bpb_po_Nomor = '' AND dd.bpbd_mkb = h.MKB_NOMOR
          AND dd.bpbd_bhn_kode = d.mkbd_bhn_kode
      ), 0)
    )) AS Kurang
  FROM tmkb_hdr h
  INNER JOIN tmkb_dtl d ON h.MKB_NOMOR = d.mkbd_mkb_nomor
  LEFT JOIN tbahan b ON b.Bhn_kode = d.mkbd_bhn_kode
  LEFT JOIN tpo_dtl i ON i.pod_mkb_nomor = d.mkbd_mkb_nomor AND i.pod_bhn_kode = d.mkbd_bhn_kode
  LEFT JOIN tspk sp ON sp.spk_nomor = h.MKB_SPK_NOMOR
    AND sp.spk_aktif = 'Y' AND sp.spk_close = 0 AND sp.spk_jumlah_jadi < sp.spk_jumlah
  LEFT JOIN tmemospk mm ON mm.mspk_nomor = h.MKB_SPK_NOMOR AND mm.mspk_aktif = 'Y'
  WHERE sp.spk_nomor IS NOT NULL OR mm.mspk_nomor IS NOT NULL
`;

const getBahanKurangCount = async (user) => {
  const bagian = (user.bagian || "").toUpperCase();
  const allowed = ["PEMBELIAN", "GUDANG", "PPIC"];
  if (!allowed.includes(bagian) && !isSuperViewer(user)) return { total: 0 };

  const sql = `SELECT COUNT(DISTINCT y.Nomor) AS Total FROM (${bahanKurangBaseQuery}) y WHERE y.Kurang > 0`;
  const [rows] = await db.query(sql);
  return { total: rows[0]?.Total || 0 };
};

// ── List ber-paginasi: langkah 1 ambil SPK page (Nomor, NamaSpk,
// JmlBahanKurang), langkah 2 ambil detail bahan utk SPK di page itu
// (WHERE Nomor IN (...)), lalu digabung jadi nested array bahanList
// per SPK. 2 query per page, bukan N+1. ──
const getBahanKurangList = async (user, limit = 20, offset = 0) => {
  const bagian = (user.bagian || "").toUpperCase();
  const allowed = ["PEMBELIAN", "GUDANG", "PPIC"];
  if (!allowed.includes(bagian) && !isSuperViewer(user)) return [];

  const sqlSpkPage = `
    SELECT y.Nomor, y.NamaSpk, COUNT(*) AS JmlBahanKurang
    FROM (${bahanKurangBaseQuery}) y
    WHERE y.Kurang > 0
    GROUP BY y.Nomor, y.NamaSpk
    ORDER BY SUM(y.Kurang) DESC
    LIMIT ? OFFSET ?
  `;
  const [spkRows] = await db.query(sqlSpkPage, [limit, offset]);
  if (!spkRows.length) return [];

  const nomorList = spkRows.map((r) => r.Nomor);
  const sqlDetail = `
    SELECT y.Nomor, y.Kode, y.NamaBahan, y.Satuan, y.Kurang
    FROM (${bahanKurangBaseQuery}) y
    WHERE y.Kurang > 0 AND y.Nomor IN (?)
    ORDER BY y.Nomor, y.Kurang DESC
  `;
  const [detailRows] = await db.query(sqlDetail, [nomorList]);

  const detailBySpk = {};
  for (const d of detailRows) {
    if (!detailBySpk[d.Nomor]) detailBySpk[d.Nomor] = [];
    detailBySpk[d.Nomor].push({
      Kode: d.Kode,
      NamaBahan: d.NamaBahan,
      Satuan: d.Satuan,
      Kurang: d.Kurang,
    });
  }

  return spkRows.map((s) => ({
    Nomor: s.Nomor,
    NamaSpk: s.NamaSpk,
    JmlBahanKurang: s.JmlBahanKurang,
    bahanList: detailBySpk[s.Nomor] || [],
  }));
};

// ── SPK Belum MKB — list ber-paginasi (count reuse getSpkBelumMkbCount
// yang sudah ada) ──
const getSpkBelumMkbListPaged = async (user, limit = 20, offset = 0) => {
  const bagian = (user.bagian || "").toUpperCase();
  const allowed = [
    "PEMBELIAN",
    "PPIC",
    "GUDANG",
    "EDP",
    "IT",
    "DIREKSI",
    "OWNER",
    "AUDIT",
  ];
  if (!allowed.includes(bagian) && !isSuperViewer(user)) return [];

  const sql = `
    SELECT
      s.spk_nomor AS Nomor,
      s.spk_nama AS Nama,
      DATE_FORMAT(s.spk_tanggal, '%d-%m-%Y') AS Tanggal,
      DATE_FORMAT(s.spk_dateline, '%d-%m-%Y') AS Dateline,
      DATEDIFF(s.spk_dateline, CURDATE()) AS SisaHari
    FROM tspk s
    WHERE s.spk_aktif = 'Y'
      AND s.spk_close = 0
      AND s.spk_cmo <> ''
      AND s.spk_jo_kode NOT IN ('BR', 'SB', 'SD', 'PL')
      AND s.spk_divisi IN (3, 4, 6)
      AND s.spk_nomor NOT IN (
        SELECT h.MKB_SPK_NOMOR FROM tmkb_hdr h WHERE h.MKB_SPK_NOMOR <> ''
      )
      AND s.spk_tanggal >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
    ORDER BY s.spk_dateline ASC
    LIMIT ? OFFSET ?
  `;
  const [rows] = await db.query(sql, [limit, offset]);
  return rows;
};

// ── Panel 4: PO Jasa vs BPB Jasa summary (bulan berjalan) ──
// Status logic persis sama seperti laporan Approve PO Jasa:
//   pojh_status_rec <> 1                                   → Belum
//   pojh_status_rec = 1 DAN masih ada detail pojd_status=0  → Proses
//   pojh_status_rec = 1 DAN semua detail sudah settled      → Closed
const getPoJasaVsBpjSummary = async (user) => {
  const bagian = (user.bagian || "").toUpperCase();
  const allowed = ["PEMBELIAN", "GUDANG", "PPIC"];
  if (!allowed.includes(bagian) && !isSuperViewer(user)) return null;

  const sql = `
    SELECT
      COUNT(*) AS TotalPO,
      SUM(CASE WHEN h.pojh_status_rec <> 1 THEN 1 ELSE 0 END) AS Belum,
      SUM(CASE WHEN h.pojh_status_rec = 1 AND EXISTS (
            SELECT 1 FROM tpojasa_dtl d
            WHERE d.pojd_status = 0 AND d.pojd_pojh_nomor = h.pojh_nomor
          ) THEN 1 ELSE 0 END) AS Proses,
      SUM(CASE WHEN h.pojh_status_rec = 1 AND NOT EXISTS (
            SELECT 1 FROM tpojasa_dtl d
            WHERE d.pojd_status = 0 AND d.pojd_pojh_nomor = h.pojh_nomor
          ) THEN 1 ELSE 0 END) AS Closed
    FROM tpojasa_hdr h
    WHERE h.pojh_tanggal >= DATE_FORMAT(NOW(), '%Y-%m-01')
      AND h.pojh_tanggal <= CURDATE()
  `;

  const [rows] = await db.query(sql);
  return rows[0] || {};
};

// ── Outstanding PO Mitra — summary + list ber-paginasi (slice
// in-memory dari getBrowse 514, sudah sorted by Kurang desc) ──
const getOutstandingPoMitraSummary = async (user) => {
  const bagian = (user.bagian || "").toUpperCase();
  const allowed = ["PEMBELIAN", "GUDANG", "PPIC"];
  if (!allowed.includes(bagian) && !isSuperViewer(user)) return null;

  const startDate = new Date().toISOString().slice(0, 8) + "01";
  const endDate = new Date().toISOString().substring(0, 10);
  const rows = await outstandingPoMitraService.getBrowse(
    startDate,
    endDate,
    "ALL",
  );

  const totalMitra = rows.length;
  const totalKurang = rows.reduce((s, r) => s + Number(r.Kurang || 0), 0);
  return { totalMitra, totalKurang };
};

const getOutstandingPoMitraList = async (user, limit = 20, offset = 0) => {
  const bagian = (user.bagian || "").toUpperCase();
  const allowed = ["PEMBELIAN", "GUDANG", "PPIC"];
  if (!allowed.includes(bagian) && !isSuperViewer(user)) return [];

  const startDate = new Date().toISOString().slice(0, 8) + "01";
  const endDate = new Date().toISOString().substring(0, 10);
  const rows = await outstandingPoMitraService.getBrowse(
    startDate,
    endDate,
    "ALL",
  );

  const sorted = [...rows].sort(
    (a, b) => Number(b.Kurang || 0) - Number(a.Kurang || 0),
  );
  return sorted.slice(offset, offset + limit);
};

// ── Efisiensi Babaran — summary + list ber-paginasi (slice in-memory
// dari getBrowse 509 mode 'spk', sorted by Minus asc) ──
const getEfisiensiBabaranSummary = async (user) => {
  const bagian = (user.bagian || "").toUpperCase();
  const allowed = ["PEMBELIAN", "GUDANG", "PPIC"];
  if (!allowed.includes(bagian) && !isSuperViewer(user)) return null;

  const startDate = new Date().toISOString().slice(0, 8) + "01";
  const endDate = new Date().toISOString().substring(0, 10);
  const rows = await standartBabaranVsRealisasiService.getBrowse(
    startDate,
    endDate,
    "ALL",
    "spk",
  );

  const totalSpk = rows.length;
  const spkDeviasi = rows.filter((r) => Number(r.Minus) < 0);
  return {
    totalSpk,
    jmlDeviasi: spkDeviasi.length,
    pctDeviasi: totalSpk ? Math.round((spkDeviasi.length / totalSpk) * 100) : 0,
  };
};

const getEfisiensiBabaranList = async (user, limit = 20, offset = 0) => {
  const bagian = (user.bagian || "").toUpperCase();
  const allowed = ["PEMBELIAN", "GUDANG", "PPIC"];
  if (!allowed.includes(bagian) && !isSuperViewer(user)) return [];

  const startDate = new Date().toISOString().slice(0, 8) + "01";
  const endDate = new Date().toISOString().substring(0, 10);
  const rows = await standartBabaranVsRealisasiService.getBrowse(
    startDate,
    endDate,
    "ALL",
    "spk",
  );

  const spkDeviasi = rows.filter((r) => Number(r.Minus) < 0);
  const sorted = [...spkDeviasi].sort(
    (a, b) => Number(a.Minus) - Number(b.Minus),
  );
  return sorted.slice(offset, offset + limit).map((r) => ({
    Nomor: r.Nomor,
    Nama: r.Nama,
    Customer: r.Customer,
    Minus: r.Minus,
    Status: r.Status,
  }));
};

// ── Stok Acc vs MKA — item aksesoris yang StokAcc < Mka (Free < 0),
// reuse getBrowse 569, filter+sort di JS (dataset per bulan relatif
// kecil, aman tanpa query SQL terpisah) ──
const getStokAccVsMkaCount = async (user) => {
  const bagian = (user.bagian || "").toUpperCase();
  const allowed = ["PEMBELIAN", "GUDANG", "PPIC"];
  if (!allowed.includes(bagian) && !isSuperViewer(user)) return { total: 0 };

  const startDate = new Date().toISOString().slice(0, 8) + "01";
  const endDate = new Date().toISOString().substring(0, 10);
  const rows = await stokAccVsMkaService.getBrowse(startDate, endDate);

  const kurang = rows.filter(
    (r) => Number(r.Free) < 0 && Number(r.StokAcc) >= 0,
  );
  return { total: kurang.length };
};

const getStokAccVsMkaList = async (user, limit = 20, offset = 0) => {
  const bagian = (user.bagian || "").toUpperCase();
  const allowed = ["PEMBELIAN", "GUDANG", "PPIC"];
  if (!allowed.includes(bagian) && !isSuperViewer(user)) return [];

  const startDate = new Date().toISOString().slice(0, 8) + "01";
  const endDate = new Date().toISOString().substring(0, 10);
  const rows = await stokAccVsMkaService.getBrowse(startDate, endDate);

  const kurang = rows.filter(
    (r) => Number(r.Free) < 0 && Number(r.StokAcc) >= 0,
  );
  const sorted = [...kurang].sort((a, b) => Number(a.Free) - Number(b.Free));
  const page = sorted.slice(offset, offset + limit);

  // Ambil breakdown per SPK untuk tiap item di halaman ini (bukan
  // seluruh dataset — cuma page-size, aman dari N+1 besar)
  const withSpkDetail = await Promise.all(
    page.map(async (r) => {
      const dtl = await stokAccVsMkaService.getDetail(
        r.Kode,
        startDate,
        endDate,
      );
      return {
        Kode: r.Kode,
        Nama: r.Nama,
        Satuan: r.Satuan,
        StokAcc: r.StokAcc,
        Mka: r.Mka,
        Free: r.Free,
        spkList: dtl.map((d) => ({
          Spk: d.Spk,
          NamaSpk: d.Nama,
          Mka: d.Mka,
          Realisasi: d.Realisasi,
          Sisa: Number(d.Mka) - Number(d.Realisasi),
        })),
      };
    }),
  );

  return withSpkDetail;
};

// ── Metric ringkas Barang Jadi ──
const getBarangJadiMetric = async (user) => {
  const bagian = (user.bagian || "").toUpperCase();
  const allowed = ["ADMIN", "PRODUKSI", "PPIC"];
  if (!allowed.includes(bagian) && !isSuperViewer(user)) return null;

  const startDate = new Date().toISOString().slice(0, 8) + "01";
  const endDate = new Date().toISOString().substring(0, 10);

  const [stokRows, mutasiRows] = await Promise.all([
    stokBarangJadiService.getBrowse(""),
    mutasiStokBarangJadiService.getBrowse(startDate, endDate, "", false),
  ]);

  const distinctKode = new Set(stokRows.map((r) => r.Kode));
  const totalStok = stokRows.reduce((s, r) => s + Number(r.Stok || 0), 0);
  const itemMinus = mutasiRows.filter((r) => Number(r.StokAkhir) < 0);

  return {
    TotalItem: distinctKode.size,
    TotalStok: totalStok,
    ItemBergerak: mutasiRows.length,
    ItemMinus: itemMinus.length,
  };
};

// ── Stok Barang Jadi saat ini — reuse getBrowse 506, sort desc Stok ──
const getStokBarangJadiList = async (
  user,
  limit = 20,
  offset = 0,
  gudang = "",
) => {
  const bagian = (user.bagian || "").toUpperCase();
  const allowed = ["ADMIN", "PRODUKSI", "PPIC"];
  if (!allowed.includes(bagian) && !isSuperViewer(user)) return [];

  const rows = await stokBarangJadiService.getBrowse(gudang);
  const sorted = [...rows].sort((a, b) => Number(b.Stok) - Number(a.Stok));
  return sorted.slice(offset, offset + limit).map((r) => ({
    Kode: r.Kode,
    Nama: r.Nama,
    Ukuran: r.Ukuran,
    Gudang: r.Gudang,
    Stok: r.Stok,
    Customer: r.Customer,
  }));
};

// ── Mutasi Barang Jadi bulan ini — reuse getBrowse 508, sort by
// |pergerakan bersih| desc (item paling aktif duluan) ──
const getMutasiBarangJadiList = async (user, limit = 20, offset = 0) => {
  const bagian = (user.bagian || "").toUpperCase();
  const allowed = ["ADMIN", "PRODUKSI", "PPIC"];
  if (!allowed.includes(bagian) && !isSuperViewer(user)) return [];

  const startDate = new Date().toISOString().slice(0, 8) + "01";
  const endDate = new Date().toISOString().substring(0, 10);
  const rows = await mutasiStokBarangJadiService.getBrowse(
    startDate,
    endDate,
    "",
    false,
  );

  const withNet = rows.map((r) => ({
    ...r,
    _net: Math.abs(
      Number(r.Stbj) +
        Number(r.MutasiMasuk) +
        Number(r.Koreksi) -
        (Number(r.SuratJalan) + Number(r.MutasiKeluar)),
    ),
  }));
  const sorted = withNet.sort((a, b) => b._net - a._net);
  return sorted.slice(offset, offset + limit).map((r) => ({
    Kode: r.Kode,
    Nama: r.Nama,
    Ukuran: r.Ukuran,
    Stbj: r.Stbj,
    MutasiMasuk: r.MutasiMasuk,
    Koreksi: r.Koreksi,
    SuratJalan: r.SuratJalan,
    MutasiKeluar: r.MutasiKeluar,
    StokAkhir: r.StokAkhir,
  }));
};

// ── Pipeline Penyelesaian SPK (SPK Aktif -> STBJ -> Kirim -> Full Invoice) ──
const getPipelinePenyelesaianSpk = async (user, startDate, endDate) => {
  const bagian = (user.bagian || "").toUpperCase();
  const allowed = ["PEMBELIAN", "GUDANG", "PPIC"];
  if (!allowed.includes(bagian) && !isSuperViewer(user)) return null;

  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  const params = [dStart, dEnd];
  let whereExtra = "";
  if (!isSuperViewer(user) && user.divisi) {
    whereExtra = "AND s.spk_divisi = ?";
    params.push(String(user.divisi));
  }

  const sql = `
    SELECT
      COUNT(DISTINCT s.spk_nomor) AS TotalAktif,
      COUNT(DISTINCT CASE WHEN EXISTS (
        SELECT 1 FROM tstbj_dtl d WHERE d.STBJD_SPK_Nomor = s.spk_nomor
      ) THEN s.spk_nomor END) AS SudahStbj,
      COUNT(DISTINCT CASE WHEN kirim.TotalKirim > 0 THEN s.spk_nomor END) AS SudahKirim,
      COUNT(DISTINCT CASE WHEN kirim.TotalKirim > 0
        AND IFNULL(inv.TotalInvoice, 0) >= kirim.TotalKirim
        THEN s.spk_nomor END) AS FullInvoice
    FROM tspk s
    LEFT JOIN (
      SELECT d.sjd_spk_nomor AS Nomor, SUM(d.sjd_jumlah) AS TotalKirim
      FROM tsj_dtl d
      INNER JOIN tsj_hdr h ON h.sj_nomor = d.sjd_sj_nomor
      WHERE h.sj_approve <> 2
        AND LEFT(d.sjd_spk_nomor, 2) = MID(h.sj_nomor, 4, 2)
      GROUP BY d.sjd_spk_nomor
    ) kirim ON kirim.Nomor = s.spk_nomor
    LEFT JOIN (
      SELECT d.invd_spk_nomor AS Nomor, SUM(d.invd_jumlah) AS TotalInvoice
      FROM tinv_dtl d
      INNER JOIN tinv_hdr h ON h.inv_nomor = d.invd_inv_nomor
      WHERE h.inv_status_otomatis = 0
      GROUP BY d.invd_spk_nomor
    ) inv ON inv.Nomor = s.spk_nomor
    WHERE s.spk_aktif = 'Y'
      AND s.spk_tanggal >= ? AND s.spk_tanggal <= ?
      ${whereExtra}
  `;

  const [rows] = await db.query(sql, params);
  return rows[0] || {};
};

// ── SPK vs STBJ (summary + list SPK belum STBJ) ──
const getSpkVsStbjSummary = async (user, startDate, endDate) => {
  const bagian = (user.bagian || "").toUpperCase();
  const allowed = ["PEMBELIAN", "GUDANG", "PPIC"];
  if (!allowed.includes(bagian) && !isSuperViewer(user)) return null;

  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  const params = [dStart, dEnd];
  let whereExtra = "";
  if (!isSuperViewer(user) && user.divisi) {
    whereExtra = "AND s.spk_divisi = ?";
    params.push(String(user.divisi));
  }

  const sql = `
    SELECT
      COUNT(*) AS TotalAktif,
      SUM(CASE WHEN stbj.TglJadi IS NOT NULL THEN 1 ELSE 0 END) AS SudahStbj,
      SUM(CASE WHEN stbj.TglJadi IS NULL THEN 1 ELSE 0 END) AS BelumStbj,
      ROUND(AVG(CASE WHEN stbj.TglJadi IS NOT NULL
            THEN DATEDIFF(stbj.TglJadi, s.spk_tanggal) END), 1) AS RataRataHari
    FROM tspk s
    LEFT JOIN (
      SELECT d.STBJD_SPK_Nomor AS Nomor, MAX(h.stbj_tanggal) AS TglJadi
      FROM tstbj_dtl d
      INNER JOIN tstbj_hdr h ON h.stbj_nomor = d.STBJD_STBJ_Nomor
      GROUP BY d.STBJD_SPK_Nomor
    ) stbj ON stbj.Nomor = s.spk_nomor
    WHERE s.spk_aktif = 'Y'
      AND s.spk_tanggal >= ? AND s.spk_tanggal <= ?
      ${whereExtra}
  `;

  const [rows] = await db.query(sql, params);
  return rows[0] || {};
};

const getSpkVsStbjList = async (
  user,
  limit = 20,
  offset = 0,
  startDate,
  endDate,
) => {
  const bagian = (user.bagian || "").toUpperCase();
  const allowed = ["PEMBELIAN", "GUDANG", "PPIC"];
  if (!allowed.includes(bagian) && !isSuperViewer(user)) return [];

  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  const params = [dStart, dEnd];
  let whereExtra = "";
  if (!isSuperViewer(user) && user.divisi) {
    whereExtra = "AND s.spk_divisi = ?";
    params.push(String(user.divisi));
  }
  params.push(limit, offset);

  const sql = `
    SELECT
      s.spk_nomor AS Nomor,
      s.spk_nama AS Nama,
      DATE_FORMAT(s.spk_tanggal, '%d-%m-%Y') AS Tanggal,
      DATE_FORMAT(s.spk_dateline, '%d-%m-%Y') AS Dateline,
      DATEDIFF(s.spk_dateline, CURDATE()) AS SisaHari
    FROM tspk s
    WHERE s.spk_aktif = 'Y'
      AND s.spk_tanggal >= ? AND s.spk_tanggal <= ?
      ${whereExtra}
      AND NOT EXISTS (
        SELECT 1 FROM tstbj_dtl d WHERE d.STBJD_SPK_Nomor = s.spk_nomor
      )
    ORDER BY s.spk_dateline ASC
    LIMIT ? OFFSET ?
  `;

  const [rows] = await db.query(sql, params);
  return rows;
};

// ── SPK vs SJ (summary + list SPK belum/sebagian kirim) ──
const getSpkVsSjSummary = async (user, startDate, endDate) => {
  const bagian = (user.bagian || "").toUpperCase();
  const allowed = ["PEMBELIAN", "GUDANG", "PPIC"];
  if (!allowed.includes(bagian) && !isSuperViewer(user)) return null;

  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  const params = [dStart, dEnd];
  let whereExtra = "";
  if (!isSuperViewer(user) && user.divisi) {
    whereExtra = "AND s.spk_divisi = ?";
    params.push(String(user.divisi));
  }

  const sql = `
    SELECT
      COUNT(*) AS TotalAktif,
      SUM(CASE WHEN IFNULL(kirim.TotalKirim, 0) = 0 THEN 1 ELSE 0 END) AS BelumKirim,
      SUM(CASE WHEN IFNULL(kirim.TotalKirim, 0) > 0
            AND IFNULL(kirim.TotalKirim, 0) < s.spk_jumlah THEN 1 ELSE 0 END) AS SebagianKirim,
      SUM(CASE WHEN IFNULL(kirim.TotalKirim, 0) >= s.spk_jumlah THEN 1 ELSE 0 END) AS LunasKirim,
      IFNULL(SUM(s.spk_jumlah), 0) AS TotalQtyOrder,
      IFNULL(SUM(IFNULL(kirim.TotalKirim, 0)), 0) AS TotalQtyKirim
    FROM tspk s
    LEFT JOIN (
      SELECT d.sjd_spk_nomor AS Nomor, SUM(d.sjd_jumlah) AS TotalKirim
      FROM tsj_dtl d
      INNER JOIN tsj_hdr h ON h.sj_nomor = d.sjd_sj_nomor
      WHERE h.sj_approve <> 2
        AND LEFT(d.sjd_spk_nomor, 2) = MID(h.sj_nomor, 4, 2)
      GROUP BY d.sjd_spk_nomor
    ) kirim ON kirim.Nomor = s.spk_nomor
    WHERE s.spk_aktif = 'Y'
      AND s.spk_tanggal >= ? AND s.spk_tanggal <= ?
      ${whereExtra}
  `;

  const [rows] = await db.query(sql, params);
  return rows[0] || {};
};

const getSpkVsSjList = async (
  user,
  limit = 20,
  offset = 0,
  startDate,
  endDate,
) => {
  const bagian = (user.bagian || "").toUpperCase();
  const allowed = ["PEMBELIAN", "GUDANG", "PPIC"];
  if (!allowed.includes(bagian) && !isSuperViewer(user)) return [];

  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  const params = [dStart, dEnd];
  let whereExtra = "";
  if (!isSuperViewer(user) && user.divisi) {
    whereExtra = "AND s.spk_divisi = ?";
    params.push(String(user.divisi));
  }
  params.push(limit, offset);

  const sql = `
    SELECT
      s.spk_nomor AS Nomor,
      s.spk_nama AS Nama,
      c.cus_nama AS NamaCustomer,
      DATE_FORMAT(s.spk_dateline, '%d-%m-%Y') AS Dateline,
      s.spk_jumlah AS QtyOrder,
      IFNULL(kirim.TotalKirim, 0) AS QtyKirim
    FROM tspk s
    INNER JOIN tcustomer c ON c.cus_kode = s.spk_cus_kode
    LEFT JOIN (
      SELECT d.sjd_spk_nomor AS Nomor, SUM(d.sjd_jumlah) AS TotalKirim
      FROM tsj_dtl d
      INNER JOIN tsj_hdr h ON h.sj_nomor = d.sjd_sj_nomor
      WHERE h.sj_approve <> 2
        AND LEFT(d.sjd_spk_nomor, 2) = MID(h.sj_nomor, 4, 2)
      GROUP BY d.sjd_spk_nomor
    ) kirim ON kirim.Nomor = s.spk_nomor
    WHERE s.spk_aktif = 'Y'
      AND s.spk_tanggal >= ? AND s.spk_tanggal <= ?
      ${whereExtra}
      AND IFNULL(kirim.TotalKirim, 0) < s.spk_jumlah
    ORDER BY s.spk_dateline ASC
    LIMIT ? OFFSET ?
  `;

  const [rows] = await db.query(sql, params);
  return rows;
};

// ── SPK Terkirim Belum Ditagih (SPK vs SJ vs Invoice) — Finance ──
const getSpkTerkirimBelumTagihSummary = async (user, startDate, endDate) => {
  const bagian = (user.bagian || "").toUpperCase();
  const allowed = ["FINANCE", "DIREKSI", "OWNER", "AUDIT", "EDP", "IT"];
  if (!allowed.includes(bagian) && !isSuperViewer(user)) return null;

  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  const params = [dStart, dEnd];

  const sql = `
    SELECT
      COUNT(DISTINCT CASE WHEN kirim.TotalKirim > 0 THEN s.spk_nomor END) AS TotalTerkirim,
      COUNT(DISTINCT CASE WHEN kirim.TotalKirim > 0 AND IFNULL(inv.TotalInvoice, 0) = 0
            THEN s.spk_nomor END) AS BelumInvoice,
      COUNT(DISTINCT CASE WHEN kirim.TotalKirim > 0 AND IFNULL(inv.TotalInvoice, 0) > 0
            AND IFNULL(inv.TotalInvoice, 0) < kirim.TotalKirim
            THEN s.spk_nomor END) AS SebagianInvoice,
      COUNT(DISTINCT CASE WHEN kirim.TotalKirim > 0
            AND IFNULL(inv.TotalInvoice, 0) >= kirim.TotalKirim
            THEN s.spk_nomor END) AS FullInvoice,
      IFNULL(SUM(CASE WHEN kirim.TotalKirim > 0
            THEN GREATEST(kirim.TotalKirim - IFNULL(inv.TotalInvoice, 0), 0)
            ELSE 0 END), 0) AS TotalQtyBelumDitagih
    FROM tspk s
    INNER JOIN (
      SELECT d.sjd_spk_nomor AS Nomor, SUM(d.sjd_jumlah) AS TotalKirim
      FROM tsj_dtl d
      INNER JOIN tsj_hdr h ON h.sj_nomor = d.sjd_sj_nomor
      WHERE h.sj_approve <> 2
        AND LEFT(d.sjd_spk_nomor, 2) = MID(h.sj_nomor, 4, 2)
      GROUP BY d.sjd_spk_nomor
    ) kirim ON kirim.Nomor = s.spk_nomor
    LEFT JOIN (
      SELECT d.invd_spk_nomor AS Nomor, SUM(d.invd_jumlah) AS TotalInvoice
      FROM tinv_dtl d
      INNER JOIN tinv_hdr h ON h.inv_nomor = d.invd_inv_nomor
      WHERE h.inv_status_otomatis = 0
      GROUP BY d.invd_spk_nomor
    ) inv ON inv.Nomor = s.spk_nomor
    WHERE s.spk_aktif = 'Y'
      AND s.spk_tanggal >= ? AND s.spk_tanggal <= ?
  `;

  const [rows] = await db.query(sql, params);
  return rows[0] || {};
};

const getSpkTerkirimBelumTagihList = async (
  user,
  limit = 20,
  offset = 0,
  startDate,
  endDate,
) => {
  const bagian = (user.bagian || "").toUpperCase();
  const allowed = ["FINANCE", "DIREKSI", "OWNER", "AUDIT", "EDP", "IT"];
  if (!allowed.includes(bagian) && !isSuperViewer(user)) return [];

  const dStart =
    startDate ||
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .substring(0, 10);
  const dEnd = endDate || new Date().toISOString().substring(0, 10);

  const params = [dStart, dEnd, limit, offset];

  const sql = `
    SELECT
      s.spk_nomor AS Nomor,
      s.spk_nama AS Nama,
      c.cus_nama AS NamaCustomer,
      kirim.TotalKirim AS QtyKirim,
      IFNULL(inv.TotalInvoice, 0) AS QtyInvoice,
      (kirim.TotalKirim - IFNULL(inv.TotalInvoice, 0)) AS QtyBelumDitagih,
      DATE_FORMAT(kirim.TglKirimTerakhir, '%d-%m-%Y') AS TglKirimTerakhir,
      DATEDIFF(CURDATE(), kirim.TglKirimTerakhir) AS UmurHari
    FROM tspk s
    INNER JOIN tcustomer c ON c.cus_kode = s.spk_cus_kode
    INNER JOIN (
      SELECT d.sjd_spk_nomor AS Nomor, SUM(d.sjd_jumlah) AS TotalKirim,
             MAX(h.sj_tanggal) AS TglKirimTerakhir
      FROM tsj_dtl d
      INNER JOIN tsj_hdr h ON h.sj_nomor = d.sjd_sj_nomor
      WHERE h.sj_approve <> 2
        AND LEFT(d.sjd_spk_nomor, 2) = MID(h.sj_nomor, 4, 2)
      GROUP BY d.sjd_spk_nomor
    ) kirim ON kirim.Nomor = s.spk_nomor
    LEFT JOIN (
      SELECT d.invd_spk_nomor AS Nomor, SUM(d.invd_jumlah) AS TotalInvoice
      FROM tinv_dtl d
      INNER JOIN tinv_hdr h ON h.inv_nomor = d.invd_inv_nomor
      WHERE h.inv_status_otomatis = 0
      GROUP BY d.invd_spk_nomor
    ) inv ON inv.Nomor = s.spk_nomor
    WHERE s.spk_aktif = 'Y'
      AND s.spk_tanggal >= ? AND s.spk_tanggal <= ?
      AND kirim.TotalKirim > IFNULL(inv.TotalInvoice, 0)
    ORDER BY UmurHari DESC
    LIMIT ? OFFSET ?
  `;

  const [rows] = await db.query(sql, params);
  return rows;
};

// ── Company Pulse Strip — ringkasan level perusahaan (Revenue MTD +
// Outstanding AR + Approval Pending), khusus isSuperViewer/Finance/Direksi.
// Query ringan: subset dari sqlSummary getPiutangDashboard (skip top5/
// overdue/trend yang berat), + reuse getApprovalPendingCount yang sudah
// ada tapi belum ke-export.
const getCompanyPulseSummary = async (user) => {
  const bagian = (user.bagian || "").toUpperCase();
  const allowed = ["FINANCE", "DIREKSI", "OWNER", "AUDIT", "EDP", "IT"];
  if (!allowed.includes(bagian)) return null;

  const sqlRevenue = `
    SELECT 
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
      ) AS InvoiceBulanIni
  `;

  const [[revRows], approvalRow] = await Promise.all([
    db.query(sqlRevenue),
    getApprovalPendingCount(),
  ]);

  const approval = approvalRow || {};
  const approvalPendingTotal = Object.values(approval).reduce(
    (s, v) => s + Number(v || 0),
    0,
  );

  return {
    revenueMtd: Number(revRows[0]?.InvoiceBulanIni) || 0,
    outstandingAr: Number(revRows[0]?.TotalOutstanding) || 0,
    approvalPendingTotal,
    approvalBreakdown: approval, // opsional, buat tooltip breakdown nanti kalau mau
  };
};

module.exports = {
  getSpkUrgent,
  getPenawaranSummary,
  getPenawaranBelumSpk,
  getSpkSummary,
  getSoSummary,
  getSoAktifTrend,
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
  getRealisasiPenawaranDashboard,
  getRealisasiPenawaranDetail,
  getMapVsSpkDashboard,
  getMapBelumSo,
  getMapVsSjDashboard,
  getMapBelumKirim,
  getSpkBelumMkbCount,
  getAktivitasHariIni,
  getAktivitasHariIniCount,
  getTrendSpk7Hari,
  getApprovalPendingCount,
  getPipelineSpkProduksi,
  getBahanKurangCount,
  getBahanKurangList,
  getSpkBelumMkbListPaged,
  getPoJasaVsBpjSummary,
  getOutstandingPoMitraSummary,
  getOutstandingPoMitraList,
  getEfisiensiBabaranSummary,
  getEfisiensiBabaranList,
  getStokAccVsMkaCount,
  getStokAccVsMkaList,
  getBarangJadiMetric,
  getStokBarangJadiList,
  getMutasiBarangJadiList,
  getPipelinePenyelesaianSpk,
  getSpkVsStbjSummary,
  getSpkVsStbjList,
  getSpkVsSjSummary,
  getSpkVsSjList,
  getSpkTerkirimBelumTagihSummary,
  getSpkTerkirimBelumTagihList,
  getAchievementSummary,
  getGrowthYoy,
  getPenawaranFunnel,
  getMapFunnel,
  getProyeksiVsRealisasiSummary,
  getPipelineMenggantung,
  getApprovalPendingCount,
  getCompanyPulseSummary,
};
