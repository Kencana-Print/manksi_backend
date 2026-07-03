const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/penjualan/sjTakNormalController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "154";

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
router.get(
  "/cek-hapus",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.cekBisaHapus,
);
router.get(
  "/cek-cetak",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.cekBisaCetak,
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  ctrl.deleteData,
);

module.exports = router;
