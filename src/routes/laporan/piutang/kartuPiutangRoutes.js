const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/piutang/kartuPiutangController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

// Parent MENU_ID (968)
router.get(
  "/",
  verifyToken,
  checkPermission(968, "view"),
  controller.getMasterKartuPiutang,
);
router.get(
  "/:cusKode/invoices",
  verifyToken,
  checkPermission(968, "view"),
  controller.getInvoiceByCustomer,
);
router.get(
  "/:invNomor/pembayaran",
  verifyToken,
  checkPermission(968, "view"),
  controller.getPembayaranByInvoice,
);

module.exports = router;
