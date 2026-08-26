const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/mkaController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 57;

// Browse master
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowse,
);

// Detail expand per nomor MKA
router.get(
  "/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetail,
);

router.get(
  "/realisasi-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getRealisasiDetail,
);

// Delete
router.delete(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.deleteData,
);

// Export header (semua row master sesuai filter)
router.get(
  "/export-header",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.exportHeader,
);

// Export detail (semua baris aksesoris sesuai filter)
router.get(
  "/export-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.exportDetail,
);

module.exports = router;
