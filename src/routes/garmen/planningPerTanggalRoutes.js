const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/planningPerTanggalController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 81;

router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowse,
);
router.get(
  "/divisi-options",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDivisiOptions,
);

module.exports = router;
