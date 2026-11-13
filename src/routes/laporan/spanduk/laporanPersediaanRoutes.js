const express = require("express");
const router = express.Router();
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");
const laporanPersediaanController = require("../../../controllers/laporan/spanduk/laporanPersediaanController");

router.get(
  "/",
  verifyToken,
  checkPermission(963, "view"),
  laporanPersediaanController.getData,
);

module.exports = router;
