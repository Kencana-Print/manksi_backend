const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/mutasiOutBarangFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "70"; // Menu Mutasi Out Garmen

// Lookup search barang (Diletakkan di atas /:nomor agar "search-barang" tidak dibaca sebagai param :nomor)
router.get("/search-barang", verifyToken, controller.searchBarang);

router.get(
  "/search-permintaan-finance",
  verifyToken,
  controller.searchPermintaanFinance,
);
router.get(
  "/detail-permintaan-finance",
  verifyToken,
  controller.getDetailPermintaanFinance,
);

// Get Detail untuk Edit Form
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetail,
);

// Save Data (Insert / Update otomatis dihandle di Service berdasarkan payload isNewMode/nomor)
router.post(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "insert"), // Akses divalidasi via BaseForm frontend juga
  controller.save,
);

module.exports = router;
