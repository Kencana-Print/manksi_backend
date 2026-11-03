// backend/src/routes/permintaanBahan.routes.js

const express = require('express');
const router = express.Router();
const permintaanBahanController = require('../../../controllers/mmt/bahan-baku-produksi/permintaanBahanController');
const verifyToken = require("../../../middleware/authMiddleware").verifyToken;

router.use(verifyToken);

// Specific routes first
router.get('/', permintaanBahanController.getPermintaanBahan);
router.get('/lookup', permintaanBahanController.lookupPermintaanBahan);
router.get('/print/:nomor', permintaanBahanController.getPermintaanBahanForPrint);
router.post('/approve', permintaanBahanController.approvePermintaan);

// Parametric routes
router.get('/:nomor', permintaanBahanController.getPermintaanBahanByNomor);
router.post('/', permintaanBahanController.savePermintaanBahan);
router.put('/:nomor', permintaanBahanController.savePermintaanBahan);
router.delete('/:nomor', permintaanBahanController.deletePermintaanBahan);

module.exports = router;
