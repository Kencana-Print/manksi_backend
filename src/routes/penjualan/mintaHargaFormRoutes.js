const express = require("express");
const router = express.Router();
const controller = require("../../controllers/penjualan/mintaHargaFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");
const upload = require("../../middleware/uploadMiddleware");

const menuId = 166;

router.get("/kalkulasi-metadata", verifyToken, controller.getKalkulasiMetadata);

// Route khusus untuk upload gambar (Harus di atas route dinamis seperti /:nomor)
router.post(
  "/upload-image/:nomor",
  verifyToken,
  upload.single("image"),
  controller.uploadImage,
);

// --- ROUTE KATALOG CUSTOMER (TAMBAHKAN DI SINI) ---
router.get(
  "/katalog/customer/:cusKode",
  verifyToken,
  controller.getKatalogCustomer,
);

// Load Data
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(menuId, "view"),
  controller.getById,
);

// Save Data (Create / Update)
router.post(
  "/save",
  verifyToken,
  checkPermission(menuId, "edit"),
  controller.save,
);

router.post(
  "/save-kalkulasi",
  verifyToken,
  checkPermission(menuId, "edit"),
  controller.saveKalkulasi,
);

module.exports = router;
