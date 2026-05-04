const express = require("express");
const router = express.Router();

const browseController = require("../../controllers/garmen/poInternalMapController");
const formController = require("../../controllers/garmen/poInternalMapFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 138;

// ── RUTE BROWSE ──
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  browseController.getBrowseList,
);
router.get(
  "/:nomor/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  browseController.getPoDetail,
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  browseController.deletePo,
);
router.get(
  "/export-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  browseController.getExportDetail,
);

// ── RUTE FORM (CREATE & EDIT) ──
// Get Data by ID
router.get(
  "/form/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  formController.getById,
);

// Validasi MAP khusus sebelum dimasukkan ke grid
router.post(
  "/form/validate-map",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  formController.validateMap,
);

// Simpan Data
router.post(
  "/form",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  formController.save,
);
router.get(
  "/form/print/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  formController.getPrintData,
);

module.exports = router;
