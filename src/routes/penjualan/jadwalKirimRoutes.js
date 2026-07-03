const express = require("express");
const router = express.Router();
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");
const ctrl = require("../../controllers/penjualan/jadwalKirimController");

const MENU_ID = 119;

// ── STATIC GET — semua WAJIB sebelum /:nomor ──────────────────────────

// Lookup gudang
router.get("/lookup/gudang", verifyToken, ctrl.getListGudang);

// Detail by filter — untuk export detail dari frontend
router.get(
  "/detail-by-filter",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDetailByFilter,
);

router.get(
  "/cetak",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getCetak,
);

// ── BROWSE ROOT ───────────────────────────────────────────────────────
router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);

// ── DYNAMIC — /:nomor SELALU PALING BAWAH ────────────────────────────

// Detail expand per baris
router.get(
  "/:nomor/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDetail,
);

// Delete
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  ctrl.deleteData,
);

module.exports = router;
