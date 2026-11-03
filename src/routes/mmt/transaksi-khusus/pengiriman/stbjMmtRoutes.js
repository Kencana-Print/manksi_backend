const { verifyToken } = require("../../../../middleware/authMiddleware");
const express = require('express');
const router = express.Router();
router.use(verifyToken);
const controller = require('../../../../controllers/mmt/transaksi-khusus/pengiriman/stbjMmtController');

// GET /api/mmt/laporan-brg-jadi/
router.get('/', controller.getReport);

module.exports = router;