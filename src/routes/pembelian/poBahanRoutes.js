const express = require("express");
const router = express.Router();
const poBahanController = require("../../controllers/pembelian/poBahanController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 52; // Sesuai kesepakatan untuk PO Bahan

// Browse Header
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  poBahanController.getBrowse,
);

// Browse Detail (Untuk expand baris)
router.get(
  "/detail/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  poBahanController.getBrowseDetail,
);

// Delete Data
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  poBahanController.deleteData,
);

// Toggle Close/Batal Close Manual (Mewajibkan hak Edit)
router.post(
  "/toggle-close",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  poBahanController.toggleClose,
);

// Pengajuan Perubahan Data (PIN)
router.post(
  "/request-pin",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  poBahanController.requestPinEdit,
);

module.exports = router;
