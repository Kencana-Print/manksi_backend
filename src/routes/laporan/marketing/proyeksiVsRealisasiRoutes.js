const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/laporan/marketing/proyeksiVsRealisasiController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

const MENU_ID = 1244;

router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);

module.exports = router;
