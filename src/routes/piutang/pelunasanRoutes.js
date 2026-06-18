const express = require("express");
const router = express.Router();
const controller = require("../../controllers/piutang/pelunasanController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

// MENU_ID Piutang > Pelunasan = 255
router.get(
  "/",
  verifyToken,
  checkPermission(255, "view"),
  controller.getBrowse,
);
router.get(
  "/export-all",
  verifyToken,
  checkPermission(255, "view"),
  controller.getAllDetail,
);
router.get(
  "/:nomor/detail",
  verifyToken,
  checkPermission(255, "view"),
  controller.getDetail,
);

// Aksi Hapus (Delete)
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(255, "delete"),
  controller.deletePelunasan,
);

// Aksi Pengajuan Perubahan Data (PIN5) -> Memerlukan akses edit
router.get(
  "/:nomor/cek-pengajuan",
  verifyToken,
  checkPermission(255, "edit"),
  controller.checkKelayakanPengajuan,
);
router.post(
  "/:nomor/request-pin",
  verifyToken,
  checkPermission(255, "edit"),
  controller.requestPin5,
);

module.exports = router;
