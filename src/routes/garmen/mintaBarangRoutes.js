const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/mintaBarangController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "60"; // Menu ID Minta Barang Garmen

// GET Browse Data
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowse,
);

// Cek Blokir Tambah Baru (Untuk Frontend sebelum redirect ke form)
router.get("/check-block", verifyToken, controller.checkBlockApprove);

// DELETE Data
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.deleteData,
);

// POST Close Data
router.post(
  "/close",
  verifyToken,
  checkPermission(MENU_ID, "edit"), // Disamakan dengan hak akses F4 (Ubah)
  controller.closeData,
);

// POST Pengajuan Perubahan (PIN5)
router.post(
  "/request-edit",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.requestEdit,
);

// POST Approve Realisasi (F7)
router.post(
  "/approve-realisasi",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.approveRealisasi,
);

module.exports = router;
