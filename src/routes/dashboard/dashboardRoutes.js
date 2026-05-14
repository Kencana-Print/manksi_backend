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

module.exports = router;
