const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/penjualan/mapVsSpkController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

// MENU_ID Laporan Penjualan -> MAP vs SPK = 308
router.get(
  "/",
  verifyToken,
  checkPermission(308, "view"),
  controller.getMapVsSpk,
);

module.exports = router;
