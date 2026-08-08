const express = require("express");
const router = express.Router();
const mkbController = require("../../controllers/pembelian/mkbController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 51;

// --- ROUTE BROWSE MKB ---
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  mkbController.getBrowse,
);

// --- ROUTE EXPORT ALL DETAIL ---
router.get(
  "/all-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  mkbController.getAllDetailData,
);

// --- ROUTE LOAD DETAIL DATA BARANG ---
router.get(
  "/:nomor/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  mkbController.getDetailData,
);

// --- ROUTE LOAD LINKED PO ---
router.get(
  "/:nomor/po",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  mkbController.getLinkedPo,
);

// --- ROUTE PENGAJUAN PIN ---
router.post(
  "/:nomor/pin",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  mkbController.requestPin,
);

// --- ROUTE HAPUS DATA ---
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  mkbController.deleteMkb,
);

module.exports = router;
