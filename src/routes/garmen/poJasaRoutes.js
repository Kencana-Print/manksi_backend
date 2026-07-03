const express = require("express");
const router = express.Router();
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");
const ctrl = require("../../controllers/garmen/poJasaController");

const MENU_ID = 102;

// ── LOOKUP (static, no menu permission needed) ────────────────────────
router.get("/lookup/jasa", verifyToken, ctrl.getJasaList);
router.get("/lookup/gudang", verifyToken, ctrl.getGudangList);

// ── EXPORT ────────────────────────────────────────────────────────────
router.get(
  "/export",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.exportData,
);
router.get(
  "/export-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.exportDetail,
);

// ── CETAK ─────────────────────────────────────────────────────────────
router.get(
  "/cetak/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDataCetak,
);
router.get(
  "/cetak-sj/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDataCetakSJ,
);

// ── DETAIL ALL (per periode) ──────────────────────────────────────────
router.get(
  "/detail-all",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getBrowseDetail,
);

// ── PENGAJUAN PIN5 ────────────────────────────────────────────────────
router.post(
  "/pengajuan-ubah",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.pengajuanUbah,
);
router.post(
  "/pengajuan-hapus",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  ctrl.pengajuanHapus,
);

// ── GET BY NOMOR via query param (edit mode, nomor mengandung '/') ────
router.get(
  "/by-nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getById,
);
router.put(
  "/by-nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.update,
);

// ── BROWSE ────────────────────────────────────────────────────────────
router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);
router.post("/", verifyToken, checkPermission(MENU_ID, "insert"), ctrl.save);

router.post(
  "/approve",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.approveData,
);

// ── DYNAMIC /:nomor — HARUS PALING BAWAH ─────────────────────────────
router.get(
  "/:nomor/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDetailByNomor,
);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getById,
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  ctrl.deleteData,
);

module.exports = router;
