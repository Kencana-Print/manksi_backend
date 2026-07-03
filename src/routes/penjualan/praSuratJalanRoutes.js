const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/penjualan/praSuratJalanController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "168";

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
  "/cek-ubah",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.cekBisaUbah,
);
// ── Create SJ (bulk convert) — sesuai Delphi ufrmPraSJ2 ──
router.get(
  "/belum-sj",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getListForCreateSj,
);
router.post(
  "/convert-sj",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.convertToSj,
);
router.get(
  "/cek-hapus",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.cekBisaHapus,
);
router.delete(
  "/:praSj",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  ctrl.deleteData,
);

module.exports = router;
