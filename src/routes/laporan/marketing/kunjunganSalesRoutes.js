const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/marketing/kunjunganSalesController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

const MENU_ID = 313;

// Browse Laporan
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowse,
);

module.exports = router;
