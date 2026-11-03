// routes/lapMonProof.routes.js
const express = require('express');
const router = express.Router();

// Import controller yang telah dibuat
const lapMonProofController = require('../../../controllers/mmt/laporan/lapMonProofController'); 

/**
 * Endpoint: GET /api/reports/monitoring-proof
 * Digunakan untuk menampilkan data di cxGrid pada aplikasi web
 */
router.get('/monitoring', lapMonProofController.getLapMonProof);

module.exports = router;