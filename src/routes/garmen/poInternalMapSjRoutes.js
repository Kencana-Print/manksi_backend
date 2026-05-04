const express = require("express");
const router = express.Router();

const sjController = require("../../controllers/garmen/poInternalMapSjController");
const formController = require("../../controllers/garmen/poInternalMapSjFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

// Sesuai dengan spesifikasi Anda: MENU_ID = 139
const MENU_ID = 139;

// --- BROWSE ---
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  sjController.getBrowseList,
);
router.get(
  "/:nomor/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  sjController.getSjDetail,
);
router.get(
  "/export-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  sjController.getExportDetail,
);

// --- HAPUS ---
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  sjController.deleteSj,
);

// --- PIN 5 (PENGAJUAN EDIT) ---
router.post(
  "/:nomor/pin5",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  sjController.requestPin5,
);

// --- RUTE FORM ---
// Ambil data detail PO untuk dimasukkan ke grid SJ
router.get(
  "/form/load-po",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  formController.loadPoItems,
);

// Ambil data SJ (Edit mode)
router.get(
  "/form/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  formController.getById,
);

// Simpan SJ
router.post(
  "/form",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  formController.save,
);

// --- RUTE CETAK ---
// Endpoint: /api/garmen/po-internal-map/surat-jalan/form/print/:nomor
router.get(
  "/form/print/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"), // Menggunakan izin 'view' karena hanya menarik data
  formController.getPrintData,
);

module.exports = router;
