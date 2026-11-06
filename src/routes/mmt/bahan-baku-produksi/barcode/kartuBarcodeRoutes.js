const { verifyToken } = require("../../../../middleware/authMiddleware");
const express = require('express');
const router = express.Router();
router.use(verifyToken);
const controller = require('../../../../controllers/mmt/bahan-baku-produksi/barcode/kartuBarcodeController');
const searchController = require('../../../../controllers/mmt/bahan-baku-produksi/barcode/searchBarcodeController');

router.get('/', controller.getSummary);

router.get('/detail', controller.getDetail);

// Riwayat pergerakan & pemakaian LHK satu barcode rol (Kartu Stok Barcode)
router.get('/history', searchController.getHistory);

module.exports = router;
