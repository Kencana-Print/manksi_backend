const express = require('express');
const router = express.Router();
const tekstilController = require('../../../controllers/mmt/laporan/lapMonTekstilController');

// Endpoint: GET /api/mmt/monitoring-tekstil
// Anda bisa menyesuaikan prefix path di file utama app.js atau index.js
router.get('/', tekstilController.getMonitoringTekstil);

module.exports = router;