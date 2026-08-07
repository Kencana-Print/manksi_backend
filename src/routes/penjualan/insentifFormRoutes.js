const express = require("express");
const router = express.Router();
const controller = require("../../controllers/penjualan/insentifFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 167;

router.get(
  "/customer/:kode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getCustomerInfo,
);

router.get(
  "/search-invoice",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.searchInvoice,
);

router.get(
  "/check-invoice",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.checkInvoice,
);

router.get(
  "/print/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getPrintData,
);

// Letakkan SETELAH route statis lain (search-invoice, check-invoice,
// print/:nomor) — supaya tidak ketangkep sebagai :nomor generik
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getById,
);

router.post(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.save,
);

module.exports = router;
