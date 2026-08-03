const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/garmen/cetakBkbjController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "143";

router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);
router.get(
  "/export",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getExportData,
);
router.get(
  "/print-data",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getPrintData,
);
router.post(
  "/cetak",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.prosesCetak,
);

module.exports = router;
