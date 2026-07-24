const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/poInternalSpkController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 124;

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
  "/check-modifiable/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.checkModifiable,
);
router.delete(
  "/delete/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.deleteData,
);

module.exports = router;
