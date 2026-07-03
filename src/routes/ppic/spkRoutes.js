const express = require("express");
const router = express.Router();
const controller = require("../../controllers/ppic/spkController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 152;

router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowse,
);
router.get(
  "/:nomor/sizes",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getSizes,
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.deleteSpk,
);
router.put(
  "/:nomor/toggle-close",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.toggleClose,
);
router.post(
  "/:nomor/request-pin",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.requestPin,
);
router.put(
  "/:nomor/approve",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.approveCmo,
);

module.exports = router;
