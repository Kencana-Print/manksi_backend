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

module.exports = router;
