// backend/src/routes/laporanKirim.routes.js
const express = require("express");
const router = express.Router();
const laporanKirimController = require('../../../controllers/mmt/laporan/lapKirimanController');

// Contoh penggunaan:
// GET /api/laporan-kirim?startDate=2026-06-01&endDate=2026-06-30&gudang=WH001
router.get("/", laporanKirimController.getLaporanKiriman);

module.exports = router;
