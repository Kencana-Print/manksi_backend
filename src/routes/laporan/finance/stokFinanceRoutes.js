const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/finance/stokFinanceController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

// Parent MENU_ID Laporan Finance = 969
router.get(
  "/cabang-list",
  verifyToken,
  checkPermission(969, "view"),
  controller.getCabangList,
);
router.get(
  "/master",
  verifyToken,
  checkPermission(969, "view"),
  controller.getMaster,
);
router.get(
  "/detail",
  verifyToken,
  checkPermission(969, "view"),
  controller.getDetail,
);

module.exports = router;
