const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/penjualan/updateStatusSjController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "155";

// Browse
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

// Form
router.get(
  "/status-list",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getStatusList,
);
router.get(
  "/form",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getFormById,
);
router.put(
  "/form/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.saveStatus,
);

module.exports = router;
