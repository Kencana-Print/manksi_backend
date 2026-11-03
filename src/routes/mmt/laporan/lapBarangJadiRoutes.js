const express = require("express");
const router = express.Router();
const mmtController = require('../../../controllers/mmt/laporan/lapBarangJadiController');

// Endpoint: GET /api/mmt/laporan-barang-jadi
router.get("/", mmtController.getReport);

module.exports = router;