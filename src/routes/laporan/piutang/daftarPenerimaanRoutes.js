const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/piutang/daftarPenerimaanController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

// Menggunakan akses parent (Laporan Piutang -> 968)
router.get(
  "/",
  verifyToken,
  checkPermission(968, "view"),
  controller.getMasterPenerimaan,
);
router.get(
  "/:noPenerimaan/detail",
  verifyToken,
  checkPermission(968, "view"),
  controller.getDetailPenerimaan,
);

module.exports = router;
