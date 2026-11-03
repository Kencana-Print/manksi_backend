const express = require('express');
const verifyToken = require("../../../middleware/authMiddleware").verifyToken;
const router = express.Router();
router.use(verifyToken);
const controller = require('../../../controllers/mmt/bahan-baku-produksi/permintaanPembelianController');

router.get('/', verifyToken, controller.getAll);
router.get('/lookup', verifyToken, controller.lookupPengajuan);
router.get('/print/:nomor', verifyToken, controller.getPengajuanForPrint);
router.post('/approve', verifyToken, controller.approvePengajuan);
router.get('/:nomor', verifyToken, controller.getByNomor);
router.post('/', verifyToken, controller.save);
router.put('/:nomor', verifyToken, controller.save);
router.delete('/:nomor', verifyToken, controller.remove);

module.exports = router;

