const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/gudang-garmen/spkBelumMkbController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

// MENU_ID Laporan SPK Belum MKB = 510
router.get(
  "/",
  verifyToken,
  checkPermission(510, "view"),
  controller.getSpkBelumMkb,
);

module.exports = router;
