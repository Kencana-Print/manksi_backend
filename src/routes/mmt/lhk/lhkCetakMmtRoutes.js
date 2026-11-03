const { verifyToken } = require("../../../middleware/authMiddleware");
// backend/routes/lhkCetak.routes.js
const express = require('express');
const router = express.Router();
router.use(verifyToken);
const lhkCetakController = require('../../../controllers/mmt/lhk/lhkCetakMmtController');

// GET /api/mmt/lhk-cetak?startDate=...&endDate=...
// backend/routes/lhkCetak.routes.js

router.get('/', lhkCetakController.getAllHeaders);
router.get('/export', lhkCetakController.exportLhk);
router.get('/rekap', lhkCetakController.getRekapLhk);
router.get('/rekap-crosstab', lhkCetakController.getRekapCrossTab);
router.get('/rekap-detail-mesin', lhkCetakController.getDetailRekapMesin);

// PINDAHKAN INI KE BAWAH agar tidak bentrok dengan /export atau /rekap
router.get('/:nomor', lhkCetakController.getOneLhk);
router.get('/detail/:nomor', lhkCetakController.getDetails);

router.post('/', lhkCetakController.saveLhk);
router.put('/:nomor', lhkCetakController.saveLhk);
router.delete('/:nomor', lhkCetakController.deleteLhk);

module.exports = router;