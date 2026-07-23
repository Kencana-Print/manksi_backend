const express = require("express");
const router = express.Router();
const controller = require("../../controllers/garmen/pembuatanBarcodeBahanController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = 135;

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
router.delete(
  "/delete/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.deleteBarcode,
);

module.exports = router;