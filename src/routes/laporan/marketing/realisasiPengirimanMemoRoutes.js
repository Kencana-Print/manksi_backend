const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/laporan/marketing/realisasiPengirimanMemoController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

const MENU_ID = 303;

router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);
router.put(
  "/reason",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  ctrl.updateReason,
);

module.exports = router;
