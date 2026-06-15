const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/gudang-garmen/kartuStokGarmenController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

// MENU_ID = 503 (Laporan Kartu Stok Barang Garmen)
router.get(
  "/",
  verifyToken,
  checkPermission(503, "view"),
  controller.getMasterStok,
);
router.get(
  "/:brgKode/detail",
  verifyToken,
  checkPermission(503, "view"),
  controller.getDetailKartuStok,
);

module.exports = router;
