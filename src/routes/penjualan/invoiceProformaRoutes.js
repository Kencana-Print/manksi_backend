const express = require("express");
const router = express.Router();
const controller = require("../../controllers/penjualan/invoiceProformaController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

// Sesuai Delphi
const MENU_ID = "157";

router.use(verifyToken);

// GET: Browse Invoice Proforma
router.get("/", checkPermission(MENU_ID, "view"), controller.getBrowseList);

// GET: Export Detail Flat
router.get(
  "/export-detail",
  checkPermission(MENU_ID, "view"),
  controller.getExportDetail,
);

// DELETE: Hapus Data Transaksi
router.delete(
  "/:nomor",
  checkPermission(MENU_ID, "delete"),
  controller.deleteData,
);

// POST: Pengajuan Buka Tutup Buku (PIN 5)
router.post(
  "/pengajuan",
  checkPermission(MENU_ID, "edit"),
  controller.requestPin5,
);

module.exports = router;
