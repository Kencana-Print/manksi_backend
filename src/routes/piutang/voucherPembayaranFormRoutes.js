const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/piutang/voucherPembayaranFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "201";

// ── Voucher (create/edit) ──
router.get(
  "/supplier/:kode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getSupplier,
);
router.get(
  "/supplier-options",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.searchSupplier,
);
router.get(
  "/nota-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getNotaDetail,
);
router.get(
  "/nota-search",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.searchNota,
);
router.get(
  "/:nomor/status-realisasi",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.cekStatusRealisasi,
);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDetailForm,
);
router.post("/", verifyToken, checkPermission(MENU_ID, "insert"), ctrl.save);
router.put("/", verifyToken, checkPermission(MENU_ID, "edit"), ctrl.update);

// ── Realisasi ──
router.get(
  "/realisasi/kode-bayar-options",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.searchKodeBayar,
);
router.get(
  "/realisasi/kode-bayar/:kode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getKodeBayar,
);
router.get(
  "/realisasi/account-options",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.searchAccount,
);
router.get(
  "/realisasi/voucher-options",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.searchVoucherRealisasi,
);
router.get(
  "/realisasi/voucher-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.loadVoucherRealisasiDetail,
);
router.get(
  "/realisasi/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDetailFormRealisasi,
);
router.post(
  "/realisasi",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  ctrl.saveRealisasi,
);
router.put(
  "/realisasi",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.updateRealisasi,
);
router.delete(
  "/realisasi/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  ctrl.hapusRealisasi,
);

module.exports = router;
