const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/laporan/gudang-garmen/browseMapController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

const MENU_ID = 528;

router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);

router.get(
  "/:nomor/bast",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getBastPrintData,
);

module.exports = router;
