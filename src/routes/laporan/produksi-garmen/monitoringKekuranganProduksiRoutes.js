const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/laporan/produksi-garmen/monitoringKekuranganProduksiController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

const MENU_ID = 555;

router.get(
  "/standar-output",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  ctrl.getStandarOutput,
);
router.get("/", verifyToken, checkPermission(MENU_ID, "view"), ctrl.getBrowse);

module.exports = router;
