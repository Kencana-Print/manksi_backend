const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/piutang/spkTerkirimBelumInvoiceController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

// ⚠️ Sementara memakai MENU_ID induk laporan piutang (968), sama seperti
// Rekap Piutang. Ganti ke ID menu laporan ini kalau sudah didaftarkan sendiri.
const MENU_ID = 968;

router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getSpkTerkirimBelumInvoice,
);

module.exports = router;
