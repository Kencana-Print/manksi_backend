const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/piutang/detailPiutangController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

// Menggunakan hak akses dari parent (MENU_ID: 968)
router.get(
  "/",
  verifyToken,
  checkPermission(968, "view"),
  controller.getMasterPiutang,
);
router.get(
  "/:invNomor/detail",
  verifyToken,
  checkPermission(968, "view"),
  controller.getDetailPiutang,
);

module.exports = router;
