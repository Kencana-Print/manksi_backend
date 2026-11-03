const express = require('express');
const router = express.Router();

// Import controller untuk monitoring sublim
const sublimController = require('../../../controllers/mmt/laporan/lapMonSublimController'); 

/**
 * Endpoint: GET /api/mmt/monitoring-sublim/sublim-monitoring
 * Digunakan untuk menarik data Log Harian Kerja Sublim & PO Internal ke dalam data-table Vue
 */
router.get('/sublim-monitoring', sublimController.getSublimMonitoring);

module.exports = router;