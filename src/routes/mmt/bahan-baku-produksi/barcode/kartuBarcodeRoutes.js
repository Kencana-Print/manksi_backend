const { verifyToken } = require("../../../../middleware/authMiddleware");
const express = require('express');
const router = express.Router();
router.use(verifyToken);
const controller = require('../../../../controllers/mmt/bahan-baku-produksi/barcode/kartuBarcodeController');

router.get('/', controller.getSummary);

router.get('/detail', controller.getDetail);

module.exports = router;