const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/laporan/gudang-garmen/standartBabaranVsRealisasiController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

const MENU_ID = 509;

// Rute statis WAJIB di atas '/:nomor' generik.
router.get(
  "/all-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getAllDetail,
);

router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);

router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDetail,
);

module.exports = router;
