const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/laporan/marketing/targetSpkController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

const MENU_ID = 312;

router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);
router.get(
  "/setting",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.getSettingList,
);
router.put(
  "/setting/target",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.updateTarget,
);
router.put(
  "/setting/sales",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.updateKodeSales,
);

module.exports = router;
