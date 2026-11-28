const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/pembelian/rekapBelumRealisasiController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

// Parent MENU_ID Laporan Pembelian = 975
router.get(
  "/",
  verifyToken,
  checkPermission(975, "view"),
  controller.getRekapBelumRealisasi,
);

module.exports = router;
