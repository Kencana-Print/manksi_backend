const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/gudang-garmen/poBahanVsMkbController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

const MENU_ID = 511;

// Browse Header
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowse,
);

// Browse Detail (beserta riwayat MKB-nya)
router.get(
  "/detail/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowseDetail,
);

module.exports = router;
