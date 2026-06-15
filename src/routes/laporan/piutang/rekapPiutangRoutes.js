const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/piutang/rekapPiutangController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

// Menggunakan parent MENU_ID (968)
router.get(
  "/",
  verifyToken,
  checkPermission(968, "view"),
  controller.getRekapPiutang,
);

module.exports = router;
