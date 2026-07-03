const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/penjualan/approvalSjController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "165";

router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);
router.get(
  "/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getBrowseDetail,
);
router.get(
  "/all-not-approved",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getAllNotApproved,
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
  "/divisi",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDivisiList,
);

router.put(
  "/approve/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  ctrl.approveSingle,
);
router.put(
  "/pending/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.setPending,
);
router.put(
  "/batal/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.batalSj,
);

router.get(
  "/bulk-list",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getBulkList,
);
router.post(
  "/bulk-approve",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  ctrl.approveBulk,
);

module.exports = router;
