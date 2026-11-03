const { verifyToken } = require("../../../middleware/authMiddleware");
const express = require('express');
const router = express.Router();
router.use(verifyToken);
const penerimaanBahanController = require('../../../controllers/mmt/bahan-baku-produksi/penerimaanBahanController');

// Specific routes first
router.get('/lookup-invoice', penerimaanBahanController.lookupPenerimaan);
router.get('/detail-invoice/:nomor', penerimaanBahanController.getDetailPenerimaan);
router.get('/po/lookup', penerimaanBahanController.lookupPO);
router.get('/po/lookup/:nomor', penerimaanBahanController.getPODetail);
router.get('/check-edit/:nomor', penerimaanBahanController.checkEditStatus);
router.get('/barcodes/:nomor', penerimaanBahanController.getGeneratedBarcodes);
router.get('/print/:nomor', penerimaanBahanController.printPenerimaanBahan);

// General & Parametric routes
router.get('/', penerimaanBahanController.getRecMmt);
router.get('/:nomor', penerimaanBahanController.getRecMmtById);
router.post('/', penerimaanBahanController.saveRecMmt);
router.put('/:nomor', penerimaanBahanController.saveRecMmt);
router.delete('/:nomor', penerimaanBahanController.deleteRecMmt);

module.exports = router;
