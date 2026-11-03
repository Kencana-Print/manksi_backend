const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/garmen/cetakBarcodeKoliController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "188";

router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);
router.get(
  "/selisih",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getSelisih,
);
router.get(
  "/:nomor/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getDetail,
);

module.exports = router;
