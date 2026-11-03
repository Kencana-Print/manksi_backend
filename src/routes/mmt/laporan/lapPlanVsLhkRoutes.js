// backend/src/routes/lapPlanVsLhk.routes.js

const express = require('express');
const router = express.Router();
const laporanController = require('../../../controllers/mmt/laporan/lapPlanVsLhkController');

// Menambahkan endpoint laporan baru
router.get('/', laporanController.getPlanVsLhk);

module.exports = router;