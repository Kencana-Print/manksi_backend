const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/laporan/gudang-garmen/monitoringMakloonController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

const MENU_ID = 572;

router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);
router.get(
  "/cabang-options",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getCabangOptions,
);

module.exports = router;
