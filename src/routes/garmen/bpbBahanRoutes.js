const express = require("express");
const router = express.Router();
const bpbBahanController = require("../../controllers/garmen/bpbBahanController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 101; // Sesuai kesepakatan untuk Browse BPB Bahan

// Browse Header
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  bpbBahanController.browseData,
);

// Browse Detail (Untuk expand baris)
router.get(
  "/detail/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  bpbBahanController.getBrowseDetail,
);

// Delete Data
router.delete(
  "/delete/:nomor", // Menyamakan pola dengan "/detail/:nomor"
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  bpbBahanController.deleteData,
);

// Pengajuan Perubahan Data (PIN)
router.post(
  "/request-pin",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  bpbBahanController.requestPin,
);

module.exports = router;
