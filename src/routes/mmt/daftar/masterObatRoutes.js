// routes/masterObat.routes.js
const express = require("express");
const router = express.Router();
const obatController = require('../../../controllers/mmt/daftar/masterObatController.js');

/**
 * Prefix dari app.js adalah: /api/master/bahan/obat
 */

// Menjadi: GET /api/master/bahan/obat
// Digunakan untuk Lookup (karena MasterBahanModal memanggil base URL ini)
router.get("/", obatController.getLookup);

// Menjadi: GET /api/master/bahan/obat/browse
// Digunakan untuk tampilan tabel utama (refresh data)
router.get("/browse", obatController.getAllObat);

// Menjadi: DELETE /api/master/bahan/obat/:kode
router.delete("/:kode", obatController.removeObat);

module.exports = router;