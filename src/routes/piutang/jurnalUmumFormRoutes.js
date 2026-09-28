const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/piutang/jurnalUmumFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "956";

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
  "/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDetailForm,
);

router.post("/", verifyToken, checkPermission(MENU_ID, "insert"), ctrl.save);
router.put("/", verifyToken, checkPermission(MENU_ID, "edit"), ctrl.update);

module.exports = router;
