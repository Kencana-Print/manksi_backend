const express = require('express');
const router = express.Router();
const jadwalKirimController = require('../../../controllers/mmt/laporan/lapMonJadwalKirimController');

// Endpoint Laporan: GET /api/jadwal-kirim/laporan?startDate=2026-01-01&endDate=2026-01-31
router.get('/laporan', jadwalKirimController.getLaporanJadwalKirim);

// Endpoint Hapus Data: DELETE /api/jadwal-kirim/:nomorKirim
router.delete('/:nomorKirim', jadwalKirimController.deleteJadwalKirim);

module.exports = router;