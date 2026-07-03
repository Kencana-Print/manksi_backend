const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/penjualan/suratJalanController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "153";

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
  "/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getBrowseDetail,
);
router.get(
  "/cek-hapus",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.cekBisaHapusUbah,
);
router.get(
  "/pengajuan-status",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getPengajuanStatus,
);
router.get(
  "/cek-kemarin",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.cekSjKemarinBelumApprove,
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
router.delete(
  "/delete",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  ctrl.deleteData,
);
router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);

module.exports = router;
