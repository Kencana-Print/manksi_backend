const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/marketing/penawaranVsMapController");
const { verifyToken } = require("../../../middleware/authMiddleware");

// Browse Laporan
router.get("/", verifyToken, controller.getBrowse);

module.exports = router;
