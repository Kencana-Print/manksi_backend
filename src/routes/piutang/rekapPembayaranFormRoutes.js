const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/piutang/rekapPembayaranFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "970";

// Statis dulu, dinamis (/:nomor) di bawah
router.get(
  "/lookups/supplier",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.searchSupplier,
);
router.get(
  "/lookups/supplier/:kode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getSupplier,
);
router.get(
  "/lookups/nota",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.searchNota,
);
router.get(
  "/lookups/nota-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getInfoNota,
);
router.get(
  "/lookups/tagihan",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getTagihan,
);
router.get(
  "/lookups/voucher",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getVoucherOptions,
);
router.get(
  "/:nomor/print",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getById,
);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getById,
);
router.post("/", verifyToken, checkPermission(MENU_ID, "insert"), ctrl.create);
router.put(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.update,
);

module.exports = router;
