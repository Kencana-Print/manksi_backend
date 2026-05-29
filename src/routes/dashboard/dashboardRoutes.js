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

module.exports = router;
