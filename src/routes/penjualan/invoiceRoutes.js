const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/penjualan/invoiceController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "156";

router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);
router.get(
  "/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getBrowseDetail,
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

router.get(
  "/status-info",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getStatusInfo,
);
router.put(
  "/status/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.saveStatusUpdate,
);

module.exports = router;
