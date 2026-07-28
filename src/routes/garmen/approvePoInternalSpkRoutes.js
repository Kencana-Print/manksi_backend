const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/approvePoInternalSpkController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 126;

router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowse,
);
router.get(
  "/detail/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetail,
);
router.get(
  "/check-approvable/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.checkApprovable,
);

module.exports = router;
