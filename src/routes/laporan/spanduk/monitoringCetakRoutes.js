const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/spanduk/monitoringCetakController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

// Menu parent Laporan > Produksi Spanduk = 963 (izin dicek di parent)
router.get(
  "/",
  verifyToken,
  checkPermission(963, "view"),
  controller.getMonitoringCetak,
);

module.exports = router;
