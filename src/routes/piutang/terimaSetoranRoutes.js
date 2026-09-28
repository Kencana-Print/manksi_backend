const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/piutang/terimaSetoranController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "959";

router.get(
  "/cabang",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getCabang,
);
router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);
router.get(
  "/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getBrowseDetail,
);
router.get(
  "/pending-all",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getBrowsePendingAll,
);

module.exports = router;
