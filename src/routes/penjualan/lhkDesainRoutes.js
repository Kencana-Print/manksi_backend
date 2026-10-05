const express = require("express");
const router = express.Router();
const controller = require("../../controllers/penjualan/lhkDesainController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 185; // ID Menu LHK Desain

router.get(
  "/outstanding",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getOutstanding,
);
router.get(
  "/history",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getHistory,
);
router.post(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "save"),
  controller.createBatch,
);

module.exports = router;
