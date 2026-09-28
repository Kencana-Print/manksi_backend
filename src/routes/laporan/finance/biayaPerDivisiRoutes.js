const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/finance/biayaPerDivisiController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

// Parent MENU_ID Laporan Finance = 969
router.get(
  "/divisi-options",
  verifyToken,
  checkPermission(969, "view"),
  controller.getListDivisi,
);
router.get(
  "/",
  verifyToken,
  checkPermission(969, "view"),
  controller.getBiayaPerDivisi,
);

module.exports = router;
