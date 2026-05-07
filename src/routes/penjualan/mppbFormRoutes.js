const express = require("express");
const router = express.Router();
const controller = require("../../controllers/penjualan/mppbFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "150";

router.use(verifyToken);

// Mendapatkan detail form (Mode Edit)
router.get("/:nomor", checkPermission(MENU_ID, "view"), controller.getDetail);

// Simpan Data (Create & Update)
router.post("/", checkPermission(MENU_ID, "insert"), controller.saveData);
router.put("/", checkPermission(MENU_ID, "edit"), controller.saveData);

// Upload Gambar (Desain & Dokumen)
router.post(
  "/upload",
  checkPermission(MENU_ID, "edit"),
  controller.uploadGambar,
);

module.exports = router;
