// backend/routes/lapLsBahanPenolong.routes.js
const express = require('express');
const router = express.Router();
const controller = require('../../../controllers/mmt/laporan/lapLsBahanPenolongController');

// GET /api/reports/ls-bahan-penolong
router.get('/', controller.getReport);

module.exports = router;