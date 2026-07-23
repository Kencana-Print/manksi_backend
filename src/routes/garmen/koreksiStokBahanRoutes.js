const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/koreksiStokBahanController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 115;

router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowse,
);
router.get(
  "/detail/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetail,
);
router.get(
  "/cetak/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDataCetak,
);
router.delete(
  "/delete/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.deleteKoreksi,
);
router.post(
  "/request-pin",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.requestPin,
);

module.exports = router;
