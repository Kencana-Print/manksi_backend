const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/spanduk/pemakaianBahanController");
const {
  verifyToken,
  checkPermission,
} = require("../../../middleware/authMiddleware");

router.get(
  "/",
  verifyToken,
  checkPermission(963, "view"),
  controller.getPemakaianBahan,
);

module.exports = router;
