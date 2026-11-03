const { verifyToken } = require("../../../middleware/authMiddleware");
const express = require('express');
const router = express.Router();
router.use(verifyToken);
const lhkLayoutController = require('../../../controllers/mmt/lhk/lhkLayoutController');

// 1. Ambil list rangkuman untuk Data Table utama (Browse/Tabel awal)
router.get('/', lhkLayoutController.getLhkLayoutList);

// 2. Ambil detail expanded row untuk sub-tabel data-table master
router.get('/details', lhkLayoutController.getLhkLayoutDetailsOnly);

// 3. Ambil data full gabungan saat load form isi (Edit mode / F1)
router.get('/load-all/:nomorSpk', lhkLayoutController.getFullLhkLayout);

// 4. Aksi simpan / update LHK Layout
router.post('/save', lhkLayoutController.saveLhkLayout);

// 5. Validasi kode bahan saat onBlur/ketik di table grid
router.get('/validate-bahan', lhkLayoutController.validateBahan);

module.exports = router;