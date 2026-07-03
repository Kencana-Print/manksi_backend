const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/garmen/stbjController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "105";

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
  "/detail-by-nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDetailByNomor,
); // ← tambah ini
router.post(
  "/pengajuan-ubah",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.pengajuanUbah,
);
router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  ctrl.deleteData,
);

module.exports = router;
