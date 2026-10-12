const express = require("express");
const router = express.Router();
const controller = require("../../controllers/pembelian/tindakLanjutQcController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 187;

router.get(
  "/browse",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.browseData,
);

router.get(
  "/lot/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetailLot,
);

router.get(
  "/riwayat/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getRiwayat,
);

router.post(
  "/keputusan/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.saveKeputusan,
);

router.post(
  "/request-pin",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.requestPin,
);

module.exports = router;
