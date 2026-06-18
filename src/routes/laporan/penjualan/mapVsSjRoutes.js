const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/penjualan/mapVsSjController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

// MENU_ID Laporan Penjualan -> MAP vs SJ MAP = 307
router.get(
  "/",
  verifyToken,
  checkPermission(307, "view"),
  controller.getMasterMap,
);
router.get(
  "/export-all",
  verifyToken,
  checkPermission(307, "view"),
  controller.getAllDetailSj,
);
router.get(
  "/:mapNomor/detail",
  verifyToken,
  checkPermission(307, "view"),
  controller.getDetailSj,
);

module.exports = router;
