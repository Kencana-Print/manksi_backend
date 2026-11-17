// routes/lapMonProof.routes.js
const express = require('express');
const router = express.Router();

// Import controller yang telah dibuat
const monitoringProofController = require('../../../controllers/mmt/laporan/monitoringProofController'); 

/**
 * Endpoint: GET /api/reports/monitoring-proof
 * Digunakan untuk menampilkan data di cxGrid pada aplikasi web
 */
router.get('/monitoring', monitoringProofController.getLapMonProof);

module.exports = router;