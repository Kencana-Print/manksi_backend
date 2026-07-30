const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/laporan/marketing/targetVsAchievementController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

const MENU_ID = 314;

router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);
router.put(
  "/proyeksi",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.updateProyeksi,
);

module.exports = router;
