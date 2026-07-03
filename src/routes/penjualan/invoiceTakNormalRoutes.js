const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/penjualan/invoiceTakNormalController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "158";

router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);

// Detail 1 — barang milik Invoice Tak Normal itu sendiri
router.get(
  "/detail-barang",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getBrowseDetailBarang,
);

// Detail 2 — daftar Invoice Normal yang dinaungi (via tinv_flag)
router.get(
  "/detail-invoice-normal",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getBrowseDetailInvoiceNormal,
);

router.get(
  "/export",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getExportData,
);
router.get(
  "/export-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getExportDetail,
);

router.get(
  "/cek-hapus",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.cekBisaHapus,
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  ctrl.deleteData,
);

router.get(
  "/cek-cetak",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.cekBisaCetak,
);
router.get(
  "/cek-ubah",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.cekBisaUbah,
);

router.get(
  "/pengajuan-status",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getPengajuanStatus,
);
router.get(
  "/cek-perlu-pengajuan",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.cekPerluPengajuan,
);
router.post(
  "/pengajuan-ubah",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.pengajuanUbah,
);

module.exports = router;
