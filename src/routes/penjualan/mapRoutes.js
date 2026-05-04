const express = require("express");
const router = express.Router();
const controller = require("../../controllers/penjualan/mapController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

// Menu ID = 162 (Sesuai instruksi)
const MENU_ID = 162;

// Rute BROWSE
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowseList,
);

// Rute HAPUS
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.deleteMap,
);

// Rute CLOSE / OPEN
router.put(
  "/:nomor/close",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.toggleClose,
);

// Rute APPROVAL CMO
router.put(
  "/:nomor/approve",
  verifyToken,
  checkPermission(MENU_ID, "edit"), // Biasanya butuh permission khusus, gunakan edit sbg fallback
  controller.approveCmo,
);

// Rute PENGAJUAN PIN 5
router.post(
  "/:nomor/pin5",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.requestPin5,
);

module.exports = router;
