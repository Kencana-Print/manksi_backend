const express = require("express");
const router = express.Router();
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");
const controller = require("../../../controllers/laporan/spanduk/monitoringKoliController");

router.get(
  "/",
  verifyToken,
  checkPermission(963, "view"),
  controller.getMonitoringKoli,
);

module.exports = router;
