const express = require("express");
const router = express.Router();
const controller = require("../../controllers/penjualan/terimaMutasiDariProduksiController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 191;

// Route statis dulu, baru dinamis
router.get(
  "/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetail,
);
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowse,
);
router.post(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.terima,
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.remove,
);

module.exports = router;
