const express = require('express');
const router = express.Router();
const { verifyToken } = require("../../../middleware/authMiddleware");

router.use(verifyToken);
const returController = require('../../../controllers/mmt/finance/returBeliController');

// Endpoint untuk mendapatkan nomor otomatis baru
router.get('/generate-nomor', returController.getNewNomor);

// Endpoint scan barcode / SKU bahan
router.get('/scan/:barcode', returController.scanItem);

// Endpoint untuk mengambil daftar semua retur beli
router.get('/', returController.getAllRetur);

// Endpoint untuk mengambil 1 retur beli lengkap beserta detailnya berdasarkan nomor
router.get('/:nomor', returController.getReturByNomor);

// Endpoint untuk menyimpan retur beli baru
router.post('/', returController.createRetur);

// Endpoint untuk update retur beli berdasarkan nomor
router.put('/:nomor', returController.updateRetur);

// Endpoint untuk hapus retur beli berdasarkan nomor
router.delete('/:nomor', returController.deleteRetur);

module.exports = router;
