const express = require('express');
const verifyToken = require("../../../../middleware/authMiddleware").verifyToken;
const router = express.Router();
router.use(verifyToken);
const mutasiInternalController = require('../../../../controllers/mmt/transaksi-khusus/spk-order/mutasiInternalController');

// Endpoint nomor otomatis baru
router.get('/generate-nomor', verifyToken, mutasiInternalController.generateNomor);

// Endpoint data detail (untuk expand row di tabel & edit view)
router.get('/detail/:nomor', verifyToken, mutasiInternalController.getDetailMutasi);

// Endpoint master list data mutasi (?startDate=...&endDate=...)
router.get('/', verifyToken, mutasiInternalController.getAllMutasi);

// Endpoint simpan mutasi internal baru
router.post('/', verifyToken, mutasiInternalController.createMutasi);

// Endpoint update mutasi internal
router.put('/:nomor', verifyToken, mutasiInternalController.updateMutasi);

// Endpoint hapus & refund stok
router.delete('/:nomor', verifyToken, mutasiInternalController.deleteMutasi);

module.exports = router;