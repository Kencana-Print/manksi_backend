const { verifyToken } = require("../../../middleware/authMiddleware");
const express = require('express');
const router = express.Router();
router.use(verifyToken);
const MmtController = require('../../../controllers/mmt/bahan-baku-produksi/mmtPinjamController');

// Route untuk mengirim permintaan pinjam (dipanggil saat scan di LHK)
router.post('/', MmtController.handleRequestPinjam);

// Route untuk melihat daftar pinjaman (dipanggil untuk notifikasi di Permintaan Produksi)
router.get('/', MmtController.getPendingLoans);

router.post('/approve-pinjam', MmtController.handleApprovePinjam);

module.exports = router;