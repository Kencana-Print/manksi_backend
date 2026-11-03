const express = require('express');
const router = express.Router();
const controller = require('../../../controllers/mmt/lhk/lhkMesinCetakController');
const { verifyToken } = require("../../../middleware/authMiddleware");

router.use(verifyToken);

// 1. ROUTE UTAMA & POST
router.get('/', controller.getAllHeaders);
router.post('/', controller.saveLhk);

// 2. ROUTE STATIS / LOOKUP (Ditaruh sebelum route yang pakai parameter :nomor)
router.get('/lookup', controller.getLookup);
router.get('/details', controller.getDetails);
router.get('/detail-lookup', controller.getDetailForLookup);

// 3. ROUTE LAPORAN & REKAP
router.get('/rekap', controller.getReportRekap);
router.get('/rekap-detail-mesin', controller.getDetailRekapPerMesin);
router.get('/report/dashboard', controller.getDashboardAgregasi);
router.get('/report/export-crosstab', controller.getExcelCrossTab);
router.get('/report/export-detail', controller.getExportLhk);

// 4. ROUTE DINAMIS PARAMETER (HARUS DI PALING BAWAH)
router.get('/lookup/:nomor', controller.getLookupByNomor);
router.delete('/:nomor', controller.deleteHeader);

module.exports = router;