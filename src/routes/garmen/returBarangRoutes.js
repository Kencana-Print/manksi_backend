const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/returBarangController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "61";

// --- Rute GET ---
// GET: Browse Retur Barang
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

// DELETE: Hapus Data Retur Barang (Diletakkan paling bawah untuk rute parameter dinamis)
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.deleteData,
);

module.exports = router;
