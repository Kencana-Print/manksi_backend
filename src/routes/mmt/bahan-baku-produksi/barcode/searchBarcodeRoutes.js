const { verifyToken } = require("../../../../middleware/authMiddleware");
const express = require('express');
const router = express.Router();
router.use(verifyToken);
const searchController = require('../../../../controllers/mmt/bahan-baku-produksi/barcode/searchBarcodeController');

/**
 * @route   GET /api/mmt/search/quick-check
 * @desc    Mencari detail barang berdasarkan barcode secara real-time dari master stok
 * @access  Public/Authenticated
 */
router.get('/quick-check', searchController.quickCheck);

router.get('/list', searchController.getInventoryList);

// Riwayat pergerakan satu barcode (kartu stok per roll).
// Ditaruh sebelum '/:param' generik bila ada, agar tidak tertukar.
router.get('/history', searchController.getHistory);

// Kamu bisa menambahkan route pencarian lainnya di sini nanti, 
// misalnya pencarian berdasarkan nama barang atau kategori.
// router.get('/by-name', searchController.findByName);

module.exports = router;