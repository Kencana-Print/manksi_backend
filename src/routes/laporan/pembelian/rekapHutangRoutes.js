const express = require("express");
const router = express.Router();
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");
const controller = require("../../../controllers/laporan/pembelian/rekapHutangController");

router.get(
  "/",
  verifyToken,
  checkPermission(975, "view"),
  controller.getRekapHutang,
);
router.get(
  "/detail",
  verifyToken,
  checkPermission(975, "view"),
  controller.getDetailHutang,
);
router.get(
  "/detail-semua",
  verifyToken,
  checkPermission(975, "view"),
  controller.getDetailSemuaHutang,
);

module.exports = router;
