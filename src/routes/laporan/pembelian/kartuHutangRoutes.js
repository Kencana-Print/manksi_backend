const express = require("express");
const router = express.Router();
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");
const controller = require("../../../controllers/laporan/pembelian/kartuHutangController");

router.get(
  "/",
  verifyToken,
  checkPermission(975, "view"),
  controller.getMaster,
);
router.get(
  "/nota",
  verifyToken,
  checkPermission(975, "view"),
  controller.getNota,
);
router.get(
  "/voucher",
  verifyToken,
  checkPermission(975, "view"),
  controller.getVoucher,
);

module.exports = router;
