const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/spanduk/rekapMonitoringByGudangController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

// Ganti dengan menu_id laporan ini di tmenu (bukan 963, itu punya laporan lain)
const MENU_ID_REKAP_MONITORING_BY_GUDANG = 963;

router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID_REKAP_MONITORING_BY_GUDANG, "view"),
  controller.getRekapMonitoringByGudang,
);

module.exports = router;
