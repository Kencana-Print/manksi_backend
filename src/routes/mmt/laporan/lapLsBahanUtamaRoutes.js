// backend/routes/lapLsBahanUtama.routes.js
const express = require('express');
const router = express.Router();
const controller = require('../../../controllers/mmt/laporan/lapLsBahanUtamaController');

// GET /api/reports/ls-bahan-utama
router.get('/', controller.getReport);

router.get('/detail', controller.getReportDetail);

router.get('/total-roll', controller.getTotalRoll);


router.get('/flow-6-bulan', controller.getFlow6Bulan);

router.get('/list-gudang', controller.getGudangList);

module.exports = router;