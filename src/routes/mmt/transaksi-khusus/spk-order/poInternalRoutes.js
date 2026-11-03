// src/routes/poInternal.routes.js
const express = require('express');
const router = express.Router();
const poiController = require('../../../../controllers/mmt/transaksi-khusus/spk-order/poInternalController.js');

// Route untuk Modal Lookup (Digunakan di Form RTR)
router.get('/lookup', poiController.getPOInternalLookup);



module.exports = router;