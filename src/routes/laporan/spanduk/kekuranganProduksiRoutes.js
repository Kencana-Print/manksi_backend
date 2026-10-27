const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/spanduk/kekuranganProduksiController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

// Izin dicek di parent "Laporan Produksi Spanduk" (menu 963)
router.get(
  "/",
  verifyToken,
  checkPermission(963, "view"),
  controller.getBrowse,
);

module.exports = router;
