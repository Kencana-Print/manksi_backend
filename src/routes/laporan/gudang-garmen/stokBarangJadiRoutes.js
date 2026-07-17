// routes/laporan/gudang-garmen/stokBarangJadiRoutes.js
const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/laporan/gudang-garmen/stokBarangJadiController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

const MENU_ID = 506;

router.get(
  "/export",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getExportData,
);

router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);

module.exports = router;
