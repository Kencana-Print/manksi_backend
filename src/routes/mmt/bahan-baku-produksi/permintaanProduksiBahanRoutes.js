const express = require('express');
const verifyToken = require("../../../middleware/authMiddleware").verifyToken;
const router = express.Router();
router.use(verifyToken);
const controller = require('../../../controllers/mmt/bahan-baku-produksi/permintaanProduksiBahanController');

// --- Route List & Lookup (Statis) ---
router.get('/', verifyToken, controller.getBrowse);
router.get('/lookup', verifyToken, controller.getLookupPermintaan); 


router.post('/', verifyToken, controller.save); // Menangani simpan baru
router.put('/', verifyToken, controller.save);  // Menangani pembaruan (Update / Edit) lama

router.get('/minta-bahan/:nomor', verifyToken, controller.getSpkDetailsAndMkb);

// --- Route Detail & Delete (Dinamis dengan Parameter) ---
// Letakkan paling bawah agar 'lookup/history' tidak dianggap sebagai ':nomor'
router.get('/:nomor', verifyToken, controller.getDetailByNomor); 
router.delete('/:nomor', verifyToken, controller.remove);

module.exports = router;