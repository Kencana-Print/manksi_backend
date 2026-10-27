const express = require("express");
const router = express.Router();
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");
const ctrl = require("../../controllers/ga/laporanPengajuanPerbaikanController");

const MENU_ID = 621;

router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getBrowse,
);

router.get(
  "/detail-all",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getAllDetail,
);

router.get(
  "/:nomor/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDetailByNomor,
);

module.exports = router;
