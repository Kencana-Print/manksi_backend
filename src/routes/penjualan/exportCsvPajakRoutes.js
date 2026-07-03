const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/penjualan/exportCsvPajakController");
const {
  verifyToken,
  checkPermission,
} = require("../../middleware/authMiddleware");

const MENU_ID = "160";

router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);
router.get(
  "/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getBrowseDetail,
);

// POST karena punya side effect (menandai isexportppn=1)
router.post(
  "/export-csv",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.exportCsv,
);
router.post(
  "/export-xlsx",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.exportXlsx,
);

module.exports = router;
