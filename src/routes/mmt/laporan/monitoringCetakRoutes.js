// routes/lapMonCetak.routes.js

const express = require('express');
const router = express.Router();

// Pastikan nama file controller sesuai: lapMonCetak.controller.js
const monitoringCetakController = require('../../../controllers/mmt/laporan/monitoringCetakController'); 

router.get('/monitoring', monitoringCetakController.lapMonCetak);

module.exports = router;