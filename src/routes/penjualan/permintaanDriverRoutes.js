const express = require("express");
const router = express.Router();
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");
const ctrl = require("../../controllers/penjualan/permintaanDriverController");

const MENU_ID = 612;

// ── STATIC GET (semua sebelum /:nomor) ──────────────────────────────────
router.get("/generate-nomor", verifyToken, ctrl.generateNomor);
router.get("/search-spk", verifyToken, ctrl.searchSpk);

// ── BROWSE ROOT ────────────────────────────────────────────────────────
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getBrowse,
);

// ── CREATE ROOT ────────────────────────────────────────────────────────
router.post(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  ctrl.create,
);

// ── DYNAMIC — /:nomor PALING BAWAH ─────────────────────────────────────
router.get(
  "/:nomor/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDetail,
);

router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getById,
);

router.put(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.update,
);

router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  ctrl.deleteData,
);

module.exports = router;
