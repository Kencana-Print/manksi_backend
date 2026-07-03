const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/penjualan/cetakFakturPajakController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "159";

router.get(
  "/check-nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.checkNomor,
);

router.get(
  "/search",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.searchInvoice,
);

// Data cetak murni (mis. utk print ulang tanpa update nomor pajak)
router.get(
  "/data-cetak",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDataCetak,
);

// Simpan nomor faktur pajak + kembalikan data cetak — sesuai
// Delphi Button1Click (save & print jadi satu aksi)
router.post(
  "/cetak",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.saveAndGetDataCetak,
);

module.exports = router;
