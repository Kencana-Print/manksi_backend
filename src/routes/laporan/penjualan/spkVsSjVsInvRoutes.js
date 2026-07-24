const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/penjualan/spkVsSjVsInvController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

const MENU_ID = 306;

router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowse,
);
router.get(
  "/export-data",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getExportData,
);
router.get(
  "/detail/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetail,
);

module.exports = router;
