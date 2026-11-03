const { verifyToken } = require("../../../middleware/authMiddleware");
const express = require('express');
const router = express.Router();
router.use(verifyToken);
const mutasiController = require('../../../controllers/mmt/bahan-baku-produksi/mutasiGudangController');

// Endpoint untuk mendapatkan nomor mutasi otomatis baru
router.get('/generate-nomor', mutasiController.generateNomor);

// Endpoint untuk mendapatkan daftar mutasi (Gunakan query params ?startDate=...&endDate=...)
router.get('/', mutasiController.getAllMutasi);

// Endpoint untuk simpan mutasi baru
router.post('/', mutasiController.createMutasi);

// Endpoint untuk update mutasi berdasarkan nomor
router.put('/:nomor', mutasiController.updateMutasi);

// Endpoint untuk detail satu dokumen (form Ubah). Ditaruh setelah
// '/generate-nomor' agar tidak tertukar (express cocok berurutan).
router.get('/:nomor', mutasiController.getMutasiDetail);
router.delete('/:nomor', mutasiController.deleteMutasi);

module.exports = router;