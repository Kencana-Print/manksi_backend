const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/sjHasilMakloonController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 182;

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
router.get(
  "/history/:nomor/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getHistoryDetail,
);
router.get(
  "/create-data",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getCreateData,
);
router.get(
  "/print/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getPrintData,
);
router.post(
  "/save",
  verifyToken,
  checkPermission(MENU_ID, "save"),
  controller.create,
);

module.exports = router;
