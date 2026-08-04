const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/returBarangFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "61";

// --- Rute Pencarian (F1 helpers) ---
router.get(
  "/search-realisasi-header",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.searchRealisasiHeader,
);
router.get(
  "/search-realisasi-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.searchRealisasiDetail,
);
router.get(
  "/search-barang",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.searchBarang,
);

// --- Rute CRUD ---
router.post(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.create,
);
router.put(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.update,
);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getFormData,
);

module.exports = router;
