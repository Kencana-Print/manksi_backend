const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/marketing/rekapPenawaranController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

const MENU_ID = 310;

router.get(
  "/rekap",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getRekap,
);
router.get(
  "/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetail,
);

module.exports = router;
