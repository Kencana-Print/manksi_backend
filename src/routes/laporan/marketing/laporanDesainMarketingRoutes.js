const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/marketing/laporanDesainMarketingController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

const MENU_ID = 316; // ID Menu Laporan Desain Marketing

router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getReport,
);
router.get(
  "/summary",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getSummary,
);

module.exports = router;
