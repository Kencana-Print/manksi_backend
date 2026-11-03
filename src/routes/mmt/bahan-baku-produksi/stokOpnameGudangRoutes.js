const { verifyToken } = require("../../../middleware/authMiddleware");
// backend/src/routes/stokOpname.routes.js

const express = require('express');
const router = express.Router();
router.use(verifyToken);
const opnameController = require('../../../controllers/mmt/bahan-baku-produksi/stokOpnameGudangController');

// 1. Mulai Sesi Opname Baru (POST)
router.post('/start', opnameController.startSession);

// 2. Scan Barcode saat Opname (GET)
// URL: /api/opname/scan?barcode=XYZ&sessionID=OPN.MMT.2602.0001
router.get('/scan', opnameController.scanBarcode);

// 3. Update Hasil Ukur Fisik (PUT)
router.put('/update', opnameController.updateScan);

// 4. Lihat Daftar Barang Belum Ditemukan (GET)
router.get('/pending/:sessionID', opnameController.getPending);

router.get('/report/:sessionID', opnameController.getReport);

module.exports = router;