const { verifyToken } = require("../../../middleware/authMiddleware");
// backend/src/routes/lhkPola.routes.js
const express = require('express');
const router = express.Router();
router.use(verifyToken);
const lhkPolaController = require('../../../controllers/mmt/lhk/lhkPolaController');

// Route Utama (Browse Header LHK Pola)
router.get('/', lhkPolaController.getAllHeaders);

// Route untuk Modal Lookup (Digunakan di LHK Desain)
router.get('/lookup', lhkPolaController.getLHKPolaLookup);

module.exports = router;