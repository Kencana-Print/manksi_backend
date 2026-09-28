const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/pembelian/pengajuanTransferFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "958";

router.get(
  "/account-options",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getAccountOptions,
);
router.get(
  "/account-all",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getAccountAll,
);
router.get(
  "/cost-center",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getCostCenterOptions,
);
router.get(
  "/dc-options",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDcOptions,
);
router.get(
  "/supplier-options",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getSupplierOptions,
);
router.get(
  "/supplier-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getSupplierDetail,
);
router.get(
  "/voucher-options",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getVoucherOptions,
);
router.get(
  "/poexternal-options",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getPoExternalOptions,
);
router.get(
  "/pettycash-options",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getPettyCashOptions,
);
router.get(
  "/bkk-options",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getBkkOptions,
);
router.get(
  "/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDetailForm,
);
router.get(
  "/print",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getPrintData,
);

router.post("/", verifyToken, checkPermission(MENU_ID, "insert"), ctrl.save);
router.put("/", verifyToken, checkPermission(MENU_ID, "edit"), ctrl.update);
router.put(
  "/realisasi",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.realisasi,
);

module.exports = router;
