const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/gudang-garmen/laporanStokBahanBarcodeController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

const MENU_ID = 501;

// Master Grid
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowse,
);

router.get(
  "/:kode/mkb-belum-realisasi",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getMkbBelumRealisasiDetail,
);

// Detail Grid (Saat di-expand / diexport)
router.get(
  "/detail/:kode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowseDetail,
);

// Ambil list rincian barcode aktif untuk modal keterangan
router.get(
  "/keterangan/:kode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getKeteranganList,
);

// Simpan batch update keterangan barcode
router.put(
  "/keterangan",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.updateKeteranganList,
);

module.exports = router;
