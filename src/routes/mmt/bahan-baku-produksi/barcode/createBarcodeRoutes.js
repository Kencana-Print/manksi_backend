const { verifyToken } = require("../../../../middleware/authMiddleware");
const express = require('express');
const router = express.Router();
router.use(verifyToken);
const controller = require('../../../../controllers/mmt/bahan-baku-produksi/barcode/recreateBarcodeController');

router.get('/next-number', controller.getNextNumber);

// 2. Simpan banyak data sekaligus (saat klik "Simpan ke Database")
router.post('/save-batch', controller.saveBatch);

// Keep existing if needed
router.post('/generate', controller.generate);

router.get('/history', controller.getHistory);

module.exports = router;