
const express = require('express');
const router = express.Router();
const reportController = require('../../../controllers/mmt/laporan/lapPemakaianBahanController');

// GET /api/reports/production-waste
router.get('/', reportController.getProductionWaste);

module.exports = router;