const express = require("express");
const router = express.Router();
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");
const ctrl = require("../../controllers/penjualan/jadwalKirimFormController");

const MENU_ID = 119;

// ── STATIC GET — semua WAJIB sebelum /:nomor ──────────────────────────
router.get("/generate-nomor", verifyToken, ctrl.generateNomor);
router.get("/spk-info", verifyToken, ctrl.getSpkInfo);
router.get("/sudah-dijadwalkan", verifyToken, ctrl.getSudahDijadwalkan);
router.get("/planning-ppic", verifyToken, ctrl.getPlanningPpic);
router.get("/cek-kota", verifyToken, ctrl.cekDuplikatKota);
router.get("/cek-jadwal-tanggal", verifyToken, ctrl.cekJadwalByTanggal);
router.get("/search-spk", verifyToken, ctrl.searchSpk);

// ── STATIC POST ───────────────────────────────────────────────────────
router.post("/", verifyToken, checkPermission(MENU_ID, "insert"), ctrl.save);

// ── DYNAMIC — /:nomor SELALU PALING BAWAH ────────────────────────────
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

module.exports = router;
