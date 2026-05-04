const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/poInternalMapApproveController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

// Sesuai requirement: MENU_ID = 140
const MENU_ID = 140;

// Browse & Detail
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowseList,
);
router.get(
  "/:nomor/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getSjDetail,
);

// Action Approve
router.post(
  "/:nomor/approve",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.approveSj,
);

// Export
router.get(
  "/export-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getExportDetail,
);

module.exports = router;
