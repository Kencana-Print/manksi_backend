const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/realisasiBarangController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware"); // Sesuaikan path jika letak authMiddleware berbeda

const MENU_ID = "62";

// --- Rute GET ---
// GET: Browse Realisasi
router.get(
  "/browse",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowse,
);

// --- Rute ACTION ---
// POST: Pengajuan PIN 5 Edit (Buka Tutup Buku)
router.post(
  "/pengajuan",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.requestEdit,
);

// DELETE: Hapus Data Realisasi (Diletakkan paling bawah untuk rute parameter dinamis)
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.deleteData,
);

module.exports = router;
