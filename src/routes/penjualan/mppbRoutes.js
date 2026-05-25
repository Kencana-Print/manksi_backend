const express = require("express");
const router = express.Router();
const controller = require("../../controllers/penjualan/mppbController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

// Sesuai Delphi
const MENU_ID = "150";

router.use(verifyToken);

// GET: Browse MPPB
router.get("/", checkPermission(MENU_ID, "view"), controller.getBrowseList);

// DELETE: Hapus Data Transaksi MPPB
router.delete(
  "/:nomor",
  checkPermission(MENU_ID, "delete"),
  controller.deleteData,
);

// POST: Pengajuan Buka Tutup Buku (PIN 5)
// Menggunakan permission "edit" sebagai syarat minimal bisa mengajukan PIN
router.post(
  "/pengajuan",
  checkPermission(MENU_ID, "edit"),
  controller.requestPin5,
);

// PUT: Toggle Approve (Ganti status Approve dari N ke Y atau sebaliknya)
// Pastikan user memiliki permission "approve" pada menu 150 ini di database role!
router.put(
  "/:nomor/approve",
  checkPermission(MENU_ID, "edit"),
  controller.toggleApprove,
);

module.exports = router;
