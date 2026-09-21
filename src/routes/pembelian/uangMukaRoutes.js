const express = require("express");
const router = express.Router();
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");
const uangMukaController = require("../../controllers/pembelian/uangMukaController");

const MENU_ID = 315;

router.use(verifyToken);

router.get(
  "/outstanding",
  checkPermission(MENU_ID, "view"),
  uangMukaController.getOutstanding,
);
router.get(
  "/outstanding/detail",
  checkPermission(MENU_ID, "view"),
  uangMukaController.getOutstandingDetail,
);
router.get(
  "/history",
  checkPermission(MENU_ID, "view"),
  uangMukaController.getHistory,
);
router.delete(
  "/history/:nomor",
  checkPermission(MENU_ID, "delete"),
  uangMukaController.deleteHistory,
);

module.exports = router;
