const express = require("express");
const router = express.Router();
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");
const ctrl = require("../../controllers/garmen/poJasaFormController");

const MENU_ID = 102;

// ── Lookup static ─────────────────────────────────────────────────────
router.get("/spk-info", verifyToken, ctrl.getSpkInfo);
router.get("/jasa", verifyToken, ctrl.getJasaList);
router.get("/planning", verifyToken, ctrl.getPlanningPpic);
router.get("/supplier", verifyToken, ctrl.getSupplierByKode);
router.get("/search-supplier", verifyToken, ctrl.searchSupplier);
router.get("/search-gudang", verifyToken, ctrl.searchGudangProduksi);
router.get("/search-bahan", verifyToken, ctrl.searchBahan);
router.get("/load-bahan", verifyToken, ctrl.loadKodeBahan);
router.get("/set-mutasi", verifyToken, ctrl.getSetFromMutasi);

// ── Validasi ──────────────────────────────────────────────────────────
router.post("/cek-gudang", verifyToken, ctrl.cekPendingGudang);

// ── GET by nomor via query param (nomor mengandung '/') ───────────────
router.get(
  "/by-nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getById,
);
router.put(
  "/by-nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.update,
);

// ── CRUD ──────────────────────────────────────────────────────────────
router.post("/", verifyToken, checkPermission(MENU_ID, "insert"), ctrl.save);

// ── Dynamic /:nomor — paling bawah ───────────────────────────────────
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getById,
);

module.exports = router;
