const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/laporan/produksi-garmen/laporanPemakaianObatController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

const MENU_ID = 565;

router.get(
  "/all-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getAllDetail,
);

router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);

router.get(
  "/:kode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDetail,
);

module.exports = router;
