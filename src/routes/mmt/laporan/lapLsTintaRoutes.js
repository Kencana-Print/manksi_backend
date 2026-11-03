const express = require("express");
const router = express.Router();
const laporanController = require('../../../controllers/mmt/laporan/lapLsTintaController');

// GET /api/laporan/stok-tinta?startDate=...&endDate=...
router.get("/", laporanController.getLaporan);

module.exports = router;