const express = require("express");
const router = express.Router();
const mapFormController = require("../../controllers/penjualan/mapFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");
const upload = require("../../middleware/uploadMiddleware");

const MENU_ID = 162;

// --- ROUTE UPLOAD GAMBAR ---
// Sesuai standar: menggunakan key "gambar"
router.post(
  "/upload-gambar",
  verifyToken,
  upload.single("gambar"),
  mapFormController.uploadImage,
);

// --- ROUTE LOOKUPS & INIT ---
// Lookup biasanya cukup verifyToken agar bisa diakses saat form terbuka
router.get("/init-grids", verifyToken, mapFormController.getInitGrids);

router.get(
  "/spk-informasi/:divisi",
  verifyToken,
  mapFormController.getSpkInformasi,
);

// --- ROUTE LOAD MINTA HARGA ---
router.get(
  "/minta-harga/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  mapFormController.loadMintaHarga,
);

// Tambah sebelum route /:nomor (GET by id harus paling bawah)
router.get(
  "/nama-suggestions",
  verifyToken,
  mapFormController.getNamaSuggestions,
);
router.get("/check-duplikat", verifyToken, mapFormController.checkDuplikatNama);

// --- ROUTE KATALOG CUSTOMER ---
router.get(
  "/katalog/customer/:cusKode",
  verifyToken,
  mapFormController.getKatalogCustomer
);

// --- ROUTE LOAD DATA MAP (EDIT MODE) ---
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  mapFormController.getById,
);

// --- ROUTE SAVE TRANSAKSI ---
router.post(
  "/save",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  mapFormController.save,
);

router.get(
  "/print/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  mapFormController.getPrintData,
);

module.exports = router;
