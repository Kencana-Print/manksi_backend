const express = require('express');
const router = express.Router();
const voucherController = require('../../../controllers/mmt/finance/voucherPelunasanController.js');
// const auth = require('../../../middleware/authMiddleware').verifyToken; // Aktifkan jika menggunakan token

// Endpoint untuk mengambil invoice yang bisa diajukan (Berdasarkan Supplier)
router.get('/outstanding/:supKode', voucherController.getOutstandingInvoices);

// Endpoint untuk simpan pengajuan voucher baru
router.post('/save', voucherController.createVoucher);

// Endpoint untuk list daftar voucher (Browsing)
router.get('/list', voucherController.getVouchers);

module.exports = router;