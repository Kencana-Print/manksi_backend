const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/penjualan/realisasiPenawaranController");
const { verifyToken } = require("../../../middleware/authMiddleware");

router.get("/dashboard-summary", verifyToken, controller.getDashboardSummary);
// Browse Header
router.get("/", verifyToken, controller.getBrowse);

module.exports = router;
