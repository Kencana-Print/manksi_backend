// backend/src/routes/stbj.routes.js
const verifyToken = require("../../../../middleware/authMiddleware").verifyToken;

const express = require('express');
const router = express.Router();
router.use(verifyToken);
const stbjController = require('../../../../controllers/mmt/transaksi-khusus/pengiriman/stbjController');

// const auth = require('../middleware/auth'); // Aktifkan jika ada sistem login
// Route untuk Browse (Master)
router.get('/', verifyToken, stbjController.browseSTBJ);

// Route untuk Detail (Sub-grid)
router.get('/browse/detail', verifyToken, stbjController.getDetail);

// Route untuk Simpan Baru
router.post('/', verifyToken, stbjController.createSTBJ);

router.get('/:nomor', verifyToken, stbjController.getSTBJByNomor);

// Route untuk Update (Edit)
router.put('/:nomor', verifyToken, stbjController.updateSTBJ);

// Route untuk Hapus
router.delete('/:nomor', verifyToken, stbjController.deleteSTBJ);

module.exports = router;