const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/garmen/cetakBarcodeKoliFormController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "188";

router.get(
  "/search-stbj",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.searchStbj,
);

router.get(
  "/:nomor/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDetail,
);

router.post(
  "/:nomor/reprint",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  ctrl.cetakUlang,
);

router.post(
  "/void",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.voidKoli,
);

module.exports = router;
