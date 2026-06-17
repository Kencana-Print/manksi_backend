const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/piutang/cekGagalLinkController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

// Parent MENU_ID Laporan Piutang = 968
router.get(
  "/",
  verifyToken,
  checkPermission(968, "view"),
  controller.getMasterGagalLink,
);
router.get(
  "/:nota/detail",
  verifyToken,
  checkPermission(968, "view"),
  controller.getDetailGagalLink,
);

// Route untuk sinkronisasi (Fix Link) - Membutuhkan hak akses edit
router.put(
  "/:nota/fix",
  verifyToken,
  checkPermission(968, "edit"),
  controller.fixGagalLink,
);

module.exports = router;
