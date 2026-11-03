const { verifyToken } = require("../../../middleware/authMiddleware");
// backend/src/routes/returProduksi.routes.js

const express = require('express');
const router = express.Router();
router.use(verifyToken);
const returController = require('../../../controllers/mmt/bahan-baku-produksi/returProduksiController');

// Endpoint untuk scan barcode (GET /api/retur/scan?barcode=...&gudangAsal=...)
router.get('/', returController.getBrowseData);

router.get('/scan', returController.scanBarcode);

// Endpoint untuk ambil nomor dokumen baru otomatis
router.get('/generate-nomor', returController.getNewNomor);

router.get('/:nomor', returController.getReturByNomor);

// Endpoint untuk simpan retur baru
router.post('/', returController.createRetur);

// Endpoint untuk update retur yang sudah ada
router.put('/:nomor', returController.updateRetur);

// Endpoint untuk hapus retur
router.delete('/:nomor', returController.deleteRetur);

module.exports = router;