const express = require('express');
const router = express.Router();
const lhkController = require('../../../controllers/mmt/lhk/lhkFinishingController');
const praController = require('../../../controllers/mmt/lhk/praLhkFinishingController');
const { verifyToken } = require("../../../middleware/authMiddleware");

router.use(verifyToken);

// ==========================================
// 1. ENDPOINT PRA-LHK (tpra_lhk_finishing)
// ==========================================

router.post('/pra', praController.saveDraft);
router.get('/pra/unassigned', praController.getUnassigned);
router.delete('/pra/:id', praController.deleteDraft);

/**
 * Ambil data SPK yang sudah dipotong tapi belum diproses di tahap selanjutnya.
 */
router.get('/pra/pending-potong', lhkController.getPendingPotong);


// ==========================================
// 2. ENDPOINT LHK FINAL (Laporan Resmi)
// ==========================================

router.get('/', lhkController.getAllHeaders);

// ROUTE BARU: Wajib diletakkan sebelum route ber-parameter dinamis (/:nomor)
router.get('/search-spk', lhkController.searchSpk);

router.get('/details', lhkController.getDetails);
router.post('/finalize', lhkController.processFinalize);

/**
 * ENDPOINT UPDATE (Hanya simpan perubahan, tanpa status ACC)
 */
router.post('/update', lhkController.updateLhk); 

/**
 * ENDPOINT ACC (Simpan perubahan + Isi kolom lfh_acc)
 */
router.post('/acc', lhkController.handleAcc); 

// Catatan: Route dengan parameter dinamis (/:nomor) SELALU ditaruh di paling bawah
router.delete('/:nomor', lhkController.deleteHeader);


module.exports = router;