const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/bastController");
const formController = require("../../controllers/garmen/bastFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 117;

// Route: /api/garmen/cetak-bast
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowseList,
);
// TAMBAHKAN RUTE INI
router.get(
  "/export-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getExportDetail,
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.deleteBast,
);

// --- RUTE FORM BAST ---
// Get data lengkap MAP + BAST (Create/Edit)
router.get(
  "/form/:nomor",
  verifyToken,
  checkPermission(117, "view"),
  formController.getBastDetails,
);

// Simpan Data
router.post(
  "/form",
  verifyToken,
  checkPermission(117, "insert"),
  formController.saveBast,
);

router.get(
  "/form/print/:nomor",
  verifyToken,
  checkPermission(117, "view"),
  formController.getPrintData,
);

// Rute untuk mengambil daftar size SPK
// Endpoint: /api/garmen/cetak-bast/form/:nomor/sizes
router.get(
  "/form/:nomor/sizes",
  verifyToken,
  checkPermission(117, "view"),
  formController.getSpkSizes,
);

module.exports = router;
