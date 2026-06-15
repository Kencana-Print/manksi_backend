const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/mintaBarangFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "60";

// Validate SPK
router.get("/validate-spk/:spk", verifyToken, controller.validateSpk);

// Lookup Gudang by Kode
router.get(
  "/gudang/:kode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getGudangByKode,
);

// Lookup Barang by Kode
router.get(
  "/barang/:kode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBarangByKode,
);

// Get Detail untuk Edit Form
// ⚠️ Route dinamis :nomor harus di bawah semua route statis
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetail,
);

// Save Data
router.post(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.save,
);

module.exports = router;
