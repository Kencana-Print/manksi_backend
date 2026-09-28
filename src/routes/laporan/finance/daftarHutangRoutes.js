const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/finance/daftarHutangController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

// Parent MENU_ID Laporan Finance = 969
router.get(
  "/",
  verifyToken,
  checkPermission(969, "view"),
  controller.getBrowse,
);
router.get(
  "/detail",
  verifyToken,
  checkPermission(969, "view"),
  controller.getDetail,
);

module.exports = router;
