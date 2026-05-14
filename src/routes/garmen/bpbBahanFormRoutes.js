const express = require("express");
const router = express.Router();
const bpbBahanFormController = require("../../controllers/garmen/bpbBahanFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 101; // BPB Bahan

// Endpoint Tarik Validasi/Data PO
router.get(
  "/validate",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  bpbBahanFormController.validateField,
);

// Endpoint Tarik Detail Edit
router.get(
  "/detail/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  bpbBahanFormController.getDetail,
);

// Endpoint Simpan Insert/Update
router.post(
  "/save",
  verifyToken,
  checkPermission(MENU_ID, "edit"), // Disamakan standar, edit permission mencakup insert & update
  bpbBahanFormController.saveData,
);

// Endpoint Tarik Max Barcode
router.get("/max-barcode", verifyToken, bpbBahanFormController.getMaxBarcode);

module.exports = router;
