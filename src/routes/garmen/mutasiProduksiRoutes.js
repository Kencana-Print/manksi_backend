const express = require("express");
const router = express.Router();
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");
const ctrl = require("../../controllers/garmen/mutasiProduksiController");

const MENU_ID = 109;

// ── STATIC GET — semua WAJIB sebelum /:nomor ──────────────────────────

// Lookup gudang produksi (untuk filter lini)
router.get("/lookup/gudang-produksi", verifyToken, ctrl.getListGudangProduksi);

// Lookup cabang
router.get("/lookup/cabang", verifyToken, ctrl.getListCabang);

// Detail by filter (untuk export detail frontend)
router.get(
  "/detail-by-filter",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDetailByFilter,
);

// ── BROWSE ROOT ───────────────────────────────────────────────────────
router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);

// ── DYNAMIC — /:nomor SELALU PALING BAWAH ────────────────────────────

// Detail expand per baris
router.get(
  "/:nomor/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDetail,
);

// Get status PIN5 sebelum form pengajuan
router.get("/:nomor/pin5-status", verifyToken, ctrl.getPin5Status);

router.get("/:nomor/perlu-pengajuan", verifyToken, ctrl.cekPerluPengajuan);

// Pengajuan ubah data
router.post(
  "/:nomor/pengajuan-ubah",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.pengajuanUbah,
);

// Pengajuan hapus data
router.post(
  "/:nomor/pengajuan-hapus",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  ctrl.pengajuanHapus,
);

// Delete
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  ctrl.deleteData,
);

module.exports = router;
