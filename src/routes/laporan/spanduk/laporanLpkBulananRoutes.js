const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/spanduk/laporanLpkBulananController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

router.use(verifyToken);

router.get("/", checkPermission(963, "view"), controller.getData);

module.exports = router;
