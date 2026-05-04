const express = require("express");
const router = express.Router();
const formController = require("../../controllers/garmen/returBahanFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "110";

// Dropdowns
router.get("/gudang-bahan", verifyToken, formController.getGudangBahan);
router.get("/gudang-produksi", verifyToken, formController.getGudangProduksi);

// Pencarian Detail dari No Realisasi
router.get(
  "/realisasi-minta",
  verifyToken,
  formController.getDetailRealisasiMinta,
);

// Route khusus untuk mengambil data cetak
// Hak akses menggunakan "view" karena cetak adalah bagian dari melihat dokumen
router.get(
  "/print/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  formController.getPrintData,
);

// Edit Mode Get Detail
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  formController.getEditDetail,
);

// Save Data (Create/Edit)
router.post(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  formController.saveData,
);
router.put(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  formController.saveData,
);

module.exports = router;
