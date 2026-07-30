const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/laporan/marketing/proyeksiBulananController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

const MENU_ID = 1294;

router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);
router.get(
  "/export",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getExportData,
);

module.exports = router;
