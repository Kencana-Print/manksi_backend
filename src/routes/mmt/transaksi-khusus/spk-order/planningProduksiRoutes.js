const { verifyToken } = require("../../../../middleware/authMiddleware");
// backend/src/routes/production.routes.js

const express = require('express');
const router = express.Router();
router.use(verifyToken);
const planningController = require('../../../../controllers/mmt/transaksi-khusus/spk-order/planningProduksiController');

/**
 * SINKRONISASI FRONTEND VUE & AXIOS
 * Base URL router ini pada server.js / app.js diasumsikan mengarah ke:
 * router.use('/api/mmt/planning-produksi', productionRoutes);
 */

// Aksi Browse: Mengambil daftar SPK terbit beserta rangkuman plan produksinya
// Jalur Akses: GET /api/mmt/planning-produksi/browse?startDate=...&endDate=...
router.get('/browse', planningController.getBrowsePlanning);

// Jalur Akses: GET /api/mmt/planning-produksi/detail/:nomor
router.get('/detail/:nomor', planningController.getDetailPlanning);

// Jalur Akses: GET /api/mmt/planning-produksi/load-spk/:nomorSpk
// Parameter diubah menjadi :nomorSpk agar sinkron dengan req.params.nomorSpk di controller
router.get('/load-spk/:nomorSpk', planningController.getSpkDetailForPlanning);
// Jalur Akses: POST /api/mmt/planning-produksi/save
// Menyimpan atau meng-update data planning spk mmt (Reset-Insert)
router.post('/save', planningController.savePlanning);

module.exports = router;