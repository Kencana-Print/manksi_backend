// backend/src/routes/permintaanProduksi.routes.js
const verifyToken = require("../../../middleware/authMiddleware").verifyToken;

const express = require('express');
const router = express.Router();
router.use(verifyToken);
const ppController = require('../../../controllers/mmt/bahan-baku-produksi/permintaanProduksiController');

// URL dasar: /api/mmt/permintaan-produksi

// 1. SCAN BARCODE (PENTING: Harus diletakkan di paling atas sebelum rute berparameter umum)
// Menggunakan regex (.+) untuk menangkap seluruh string barcode yang mengandung tanda hubung (-)
router.get('/stok-barcode/:barcode', verifyToken, ppController.getStokByBarcode);

// 2. READ ALL (Browse)
router.get('/', verifyToken, ppController.getPermintaanProduksi);
router.get('/:nomor', verifyToken, ppController.getDetailByNomor);

// 3. SAVE (Baru)
router.post('/', verifyToken, ppController.savePermintaanProduksi);

// 4. SAVE (Update)
router.put('/', verifyToken, ppController.savePermintaanProduksi);

// 5. DELETE
// Diletakkan di bawah agar tidak bentrok dengan rute 'stok-barcode'
router.delete('/:nomor', verifyToken, ppController.deletePermintaanProduksi);

module.exports = router;