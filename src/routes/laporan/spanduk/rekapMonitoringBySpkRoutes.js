const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/spanduk/rekapMonitoringBySpkController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

router.get(
  "/",
  verifyToken,
  checkPermission(963, "view"),
  controller.getRekapMonitoringBySpk,
);

module.exports = router;
