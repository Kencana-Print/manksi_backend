const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/permintaanPembelianFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");
const uploadMiddleware = require("../../middleware/uploadMiddleware");

const MENU_ID = 65;

router.get(
  "/barang/:kode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBarangByKode,
);
router.post(
  "/gambar/:nomor/:kode",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  uploadMiddleware.single("gambar"),
  controller.uploadGambarItem,
);
router.delete(
  "/gambar/:nomor/:kode",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.deleteGambarItem,
);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetail,
);
router.post(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.saveData,
);
router.post(
  "/save-realisasi",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.saveRealisasi,
);

module.exports = router;
