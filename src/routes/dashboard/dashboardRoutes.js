const express = require("express");
const router = express.Router();
const controller = require("../../controllers/dashboard/dashboardController");
const { verifyToken } = require("../../middleware/authMiddleware");

// Semua route dashboard hanya butuh verifyToken
// (tidak perlu checkPermission — dashboard bukan menu ERP)
router.get("/spk-urgent", verifyToken, controller.getSpkUrgent);
router.get("/penawaran-summary", verifyToken, controller.getPenawaranSummary);
router.get(
  "/penawaran-belum-spk",
  verifyToken,
  controller.getPenawaranBelumSpk,
);
router.get("/spk-summary", verifyToken, controller.getSpkSummary);
router.get("/so-summary", verifyToken, controller.getSoSummary);
router.get("/so-aktif-trend", verifyToken, controller.getSoAktifTrend);
router.get("/po-bahan-sisa", verifyToken, controller.getPoBahanSisa);
router.get(
  "/po-bahan-bpb-summary",
  verifyToken,
  controller.getPoBahanVsBpbSummary,
);
router.get(
  "/penawaran-belum-map",
  verifyToken,
  controller.getPenawaranBelumMap,
);
router.get(
  "/penawaran-map-summary",
  verifyToken,
  controller.getPenawaranMapSummary,
);
router.get(
  "/kunjungan-sales-summary",
  verifyToken,
  controller.getKunjunganSalesSummary,
);
router.get("/piutang-dashboard", verifyToken, controller.getPiutangDashboard);
router.get("/piutang-overdue", verifyToken, controller.getPiutangOverdue);
router.get("/penerimaan-summary", verifyToken, controller.getPenerimaanSummary);
router.get(
  "/gudang-bahan-dashboard",
  verifyToken,
  controller.getGudangBahanDashboard,
);
router.get(
  "/gudang-bahan-buffer",
  verifyToken,
  controller.getGudangBahanBuffer,
);
router.get(
  "/gudang-bahan-barcode",
  verifyToken,
  controller.getGudangBahanBarcode,
);
router.get(
  "/realisasi-penawaran",
  verifyToken,
  controller.getRealisasiPenawaranDashboard,
);
router.get(
  "/realisasi-penawaran-detail",
  verifyToken,
  controller.getRealisasiPenawaranDetail,
);
router.get(
  "/map-vs-spk-dashboard",
  verifyToken,
  controller.getMapVsSpkDashboard,
);
router.get("/map-belum-spk", verifyToken, controller.getMapBelumSpk);
router.get("/map-vs-sj-dashboard", verifyToken, controller.getMapVsSjDashboard);
router.get("/map-belum-kirim", verifyToken, controller.getMapBelumKirim);
router.get("/spk-belum-mkb-count", verifyToken, controller.getSpkBelumMkbCount);
router.get("/aktivitas-hari-ini", verifyToken, controller.getAktivitasHariIni);
router.get("/trend-spk-7hari", verifyToken, controller.getTrendSpk7Hari);
router.get(
  "/approval-pending-count",
  verifyToken,
  controller.getApprovalPendingCount,
);
router.get("/company-pulse", verifyToken, controller.getCompanyPulseSummary);
router.get(
  "/pipeline-spk-produksi",
  verifyToken,
  controller.getPipelineSpkProduksi,
);
router.get("/bahan-kurang-count", verifyToken, controller.getBahanKurangCount);
router.get("/bahan-kurang-list", verifyToken, controller.getBahanKurangList);
router.get(
  "/spk-belum-mkb-list-paged",
  verifyToken,
  controller.getSpkBelumMkbListPaged,
);
router.get(
  "/po-jasa-vs-bpj-summary",
  verifyToken,
  controller.getPoJasaVsBpjSummary,
);
router.get(
  "/outstanding-po-mitra-summary",
  verifyToken,
  controller.getOutstandingPoMitraSummary,
);
router.get(
  "/outstanding-po-mitra-list",
  verifyToken,
  controller.getOutstandingPoMitraList,
);
router.get(
  "/efisiensi-babaran-summary",
  verifyToken,
  controller.getEfisiensiBabaranSummary,
);
router.get(
  "/efisiensi-babaran-list",
  verifyToken,
  controller.getEfisiensiBabaranList,
);
router.get(
  "/stok-acc-vs-mka-count",
  verifyToken,
  controller.getStokAccVsMkaCount,
);
router.get(
  "/stok-acc-vs-mka-list",
  verifyToken,
  controller.getStokAccVsMkaList,
);
router.get("/barang-jadi-metric", verifyToken, controller.getBarangJadiMetric);
router.get(
  "/stok-barang-jadi-list",
  verifyToken,
  controller.getStokBarangJadiList,
);
router.get(
  "/mutasi-barang-jadi-list",
  verifyToken,
  controller.getMutasiBarangJadiList,
);
router.get(
  "/pipeline-penyelesaian-spk",
  verifyToken,
  controller.getPipelinePenyelesaianSpk,
);
router.get("/spk-vs-stbj-summary", verifyToken, controller.getSpkVsStbjSummary);
router.get("/spk-vs-stbj-list", verifyToken, controller.getSpkVsStbjList);
router.get("/spk-vs-sj-summary", verifyToken, controller.getSpkVsSjSummary);
router.get("/spk-vs-sj-list", verifyToken, controller.getSpkVsSjList);
router.get(
  "/spk-terkirim-belum-tagih-summary",
  verifyToken,
  controller.getSpkTerkirimBelumTagihSummary,
);
router.get(
  "/spk-terkirim-belum-tagih-list",
  verifyToken,
  controller.getSpkTerkirimBelumTagihList,
);
router.get(
  "/achievement-summary",
  verifyToken,
  controller.getAchievementSummary,
);
router.get("/growth-yoy", verifyToken, controller.getGrowthYoy);
router.get("/penawaran-funnel", verifyToken, controller.getPenawaranFunnel);
router.get("/map-funnel", verifyToken, controller.getMapFunnel);
router.get(
  "/proyeksi-vs-realisasi-summary",
  verifyToken,
  controller.getProyeksiVsRealisasiSummary,
);
router.get(
  "/pipeline-menggantung",
  verifyToken,
  controller.getPipelineMenggantung,
);

router.get(
  "/map-spk-belum-permintaan-summary",
  verifyToken,
  controller.getMapSpkBelumPermintaanSummary,
);
router.get(
  "/map-spk-belum-permintaan-list",
  verifyToken,
  controller.getMapSpkBelumPermintaanList,
);
router.get(
  "/permintaan-belum-realisasi-summary",
  verifyToken,
  controller.getPermintaanBelumRealisasiSummary,
);
router.get(
  "/permintaan-belum-realisasi-list",
  verifyToken,
  controller.getPermintaanBelumRealisasiList,
);
router.get(
  "/po-bahan-belum-datang-summary",
  verifyToken,
  controller.getPoBahanBelumDatangSummary,
);
router.get(
  "/po-bahan-belum-datang-list",
  verifyToken,
  controller.getPoBahanBelumDatangList,
);
router.get("/stok-bebas-summary", verifyToken, controller.getStokBebasSummary);
router.get("/stok-bebas-list", verifyToken, controller.getStokBebasList);
router.get(
  "/buffer-kaosan-summary",
  verifyToken,
  controller.getBufferKaosanSummary,
);
router.get("/buffer-kaosan-list", verifyToken, controller.getBufferKaosanList);

module.exports = router;
