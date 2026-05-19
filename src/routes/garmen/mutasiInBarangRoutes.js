const express = require("express");
const router = express.Router();
const mutasiInBarangController = require("../../controllers/garmen/mutasiInBarangController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const menuId = 69;

// Get Master-Detail Data
router.get(
  "/",
  verifyToken,
  checkPermission(menuId, "view"),
  mutasiInBarangController.getBrowse,
);

// Post Aksi Terima Mutasi (Membutuhkan hak Edit/Save sesuai logika Delphi)
router.post(
  "/terima/:nomor",
  verifyToken,
  checkPermission(menuId, "edit"),
  mutasiInBarangController.terimaMutasi,
);

module.exports = router;
