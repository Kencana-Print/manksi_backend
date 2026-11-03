const { verifyToken } = require("../../../middleware/authMiddleware");
// backend/src/routes/koreksiStokMmt.routes.js (CommonJS Style)

const express = require('express');
const router = express.Router();
router.use(verifyToken);
const controller = require('../../../controllers/mmt/bahan-baku-produksi/koreksiStokMmtController'); // Menggunakan require


router.get('/stok', controller.getStokGudangForKoreksi);
router.get(`/detail`, controller.getKoreksiStokDetail);
router.get(`/`, controller.getKoreksiStok);
router.get(`/:nomor`, controller.getKoreksiStokByNomor);
router.delete(`/:nomor`, controller.deleteKoreksiStok);
router.post('/', controller.saveKoreksiStok);

module.exports = router; 