const express = require("express");
const router = express.Router();
const controller = require("../../controllers/penjualan/penawaranFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");
const upload = require("../../middleware/uploadMiddleware"); // Pastikan path import benar

const MENU_ID = 151;

// --- ROUTE UPLOAD GAMBAR ---
// Catatan: frontend mengirim form data dengan key "gambar" (formData.append("gambar", file))
router.post(
  "/upload-gambar",
  verifyToken,
  upload.single("gambar"),
  controller.uploadImage,
);

// Route Load Minta Harga
router.get(
  "/minta-harga/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.loadMintaHarga,
);

// Route Load Data Penawaran (Edit Mode)
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getById,
);

// Route Save Transaksi
router.post(
  "/save",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.save,
);

module.exports = router;
