const express = require("express");
const router = express.Router();
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");
const ctrl = require("../../controllers/garmen/bpbJasaFormController");

const MENU_ID = 104;

// ── Lookup / helper ───────────────────────────────────────────────────
router.get("/po", verifyToken, ctrl.getDataPO);
router.get("/komponen", verifyToken, ctrl.getKomponenList);
router.get("/babaran-std", verifyToken, ctrl.getBabaranStd);
router.get("/kelompok-tujuan", verifyToken, ctrl.getKelompokTujuan);
router.get("/realisasi-minta", verifyToken, ctrl.getDataRealisasiMinta);

// ── GET BY NOMOR via query (nomor mengandung '/') ─────────────────────
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

// ── Dynamic — paling bawah ────────────────────────────────────────────
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getById,
);

module.exports = router;
