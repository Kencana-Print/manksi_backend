const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/spkGudangController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 79;

// Browse master
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowse,
);

// Detail expand per nomor SPK Gudang
router.get(
  "/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetail,
);

// Delete
router.delete(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.deleteData,
);

// Export header
router.get(
  "/export-header",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.exportHeader,
);

// Export detail
router.get(
  "/export-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.exportDetail,
);

module.exports = router;
