const express = require("express");
const router = express.Router();
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");
const ctrl = require("../../controllers/garmen/mutasiProduksiFormController");

const MENU_ID = 109;

// ── STATIC GET ────────────────────────────────────────────────────────
router.get("/gudang-mutasi", verifyToken, ctrl.getGudangByMutasi);
router.get("/spk-info", verifyToken, ctrl.getSpkInfo);
router.get("/komponen", verifyToken, ctrl.getKomponenList);
router.get("/babaran", verifyToken, ctrl.getBabaranInfo);
router.get("/search-material", verifyToken, ctrl.searchNoMaterial);
router.get("/material-detail", verifyToken, ctrl.getNoMaterialDetail);
router.get("/planning", verifyToken, ctrl.getPlanningPpic);
router.get("/kelompok", verifyToken, ctrl.getKelompokList);
router.get("/kelompok-tujuan", verifyToken, ctrl.getKelompokTujuanList);
router.get("/search-bahan", verifyToken, ctrl.searchBahan);
router.get("/load-bahan", verifyToken, ctrl.loadKodeBahan);
router.get("/komponen-map", verifyToken, ctrl.loadKomponenMap);
router.get("/komponen-proof", verifyToken, ctrl.getKomponenProof);
router.get("/search-gudang", verifyToken, ctrl.searchGudangProduksi);
router.get("/nama-gudang", verifyToken, ctrl.getNamaGudang);
router.get("/proses-sebelumnya", verifyToken, ctrl.getProsesSebelumnya);
router.get("/bahan-suffix", verifyToken, ctrl.searchBahanBySuffix);
router.get("/cek-komponen", verifyToken, ctrl.cekKomponenIdentifikasi);

// ── STATIC POST ───────────────────────────────────────────────────────
router.post("/cek-gudang-asal", verifyToken, ctrl.cekGudangAsal);

router.post("/", verifyToken, checkPermission(MENU_ID, "insert"), ctrl.save);

// GET by nomor via query param
router.get(
  "/by-nomor",
  verifyToken,
  checkPermission("109", "view"),
  ctrl.getById,
);

// PUT update via body
router.put(
  "/by-nomor",
  verifyToken,
  checkPermission("109", "edit"),
  ctrl.update,
);

// ── DYNAMIC — /:nomor SELALU PALING BAWAH ────────────────────────────
router.get(
  "/cetak/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDataCetak,
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

module.exports = router;
