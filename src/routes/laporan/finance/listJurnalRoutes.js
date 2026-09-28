const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/finance/listJurnalController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

// Parent MENU_ID Laporan Finance = 969
router.get(
  "/",
  verifyToken,
  checkPermission(969, "view"),
  controller.getListJurnal,
);

module.exports = router;
