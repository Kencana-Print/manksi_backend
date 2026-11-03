const { verifyToken } = require("../../../middleware/authMiddleware");
// routes/lhkTekstilMmt.route.js
const express = require('express');
const router = express.Router();
router.use(verifyToken);
const lhkController = require('../../../controllers/mmt/lhk/lhkTekstilMmtController');

// --- 1. Static & Lookup Routes (Dahulukan) ---
router.get('/', lhkController.getLhkList);
router.get('/lookup', lhkController.getLhkLookup);
router.get('/approval-list', lhkController.getApprovalList); // Endpoint untuk history approval


router.get('/details', lhkController.getLhkDetails); 

// --- 2. Action Routes (POST/DELETE) ---
router.post('/approve', lhkController.handleSaveApproval);
router.post('/', lhkController.handleSaveLhk);
router.delete('/:nomor', lhkController.removeLhk);

// --- 3. Parameter Routes (Letakkan di Paling Bawah) ---
router.get('/approval/:nomor', lhkController.getApprovalFullData); // Ambil detail history approval
router.get('/detail/:nomor', lhkController.getLhkDetails);
router.get('/:nomor', lhkController.getLhkFullData);

module.exports = router;