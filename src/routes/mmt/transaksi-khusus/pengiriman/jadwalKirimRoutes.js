const express = require('express');
const verifyToken = require("../../../../middleware/authMiddleware").verifyToken;
const router = express.Router();
router.use(verifyToken);
const controller = require('../../../../controllers/mmt/transaksi-khusus/pengiriman/jadwalKirimController');

// Endpoint untuk menampilkan data (Browse)
router.get('/', verifyToken, controller.browseJadwal);

// Endpoint untuk mencetak data (Laporan)
// Ditempatkan sebelum /save agar tidak tertukar dengan route dinamis jika ada
router.get('/print', verifyToken, controller.printJadwal);

// Endpoint untuk menyimpan data (Insert/Update)
router.post('/save', verifyToken, controller.saveJadwal);

// Endpoint untuk menghapus data
router.delete('/delete', verifyToken, controller.deleteJadwal);

router.get('/:nomor', verifyToken, controller.getDetailJadwal);

module.exports = router;