const express = require('express');
const router = express.Router();
const laporanBsController = require('../../../controllers/mmt/laporan/lapMonBsController');
const { verifyToken } = require('../../../middleware/authMiddleware');

router.use(verifyToken);

// =========================================================================
// RUTE LAPORAN BARANG SISA (BS)
// =========================================================================

// GET /api/mmt/laporan-bs?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&type=ALL&gdgKode=...&search=...
router.get('/', laporanBsController.getLaporanBS);

module.exports = router;
