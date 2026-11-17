const express = require('express');
const router = express.Router();
const monitoringBsController = require('../../../controllers/mmt/laporan/monitoringBsController');
const { verifyToken } = require('../../../middleware/authMiddleware');

router.use(verifyToken);

// =========================================================================
// RUTE LAPORAN BARANG SISA (BS)
// =========================================================================

// GET /api/mmt/laporan-bs?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&type=ALL&gdgKode=...&search=...
router.get('/', monitoringBsController.getLaporanBS);

module.exports = router;
