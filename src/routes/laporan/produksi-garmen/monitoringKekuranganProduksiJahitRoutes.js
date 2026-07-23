const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/produksi-garmen/monitoringKekuranganProduksiJahitController");
const { verifyToken } = require("../../../middleware/authMiddleware");

// Browse Laporan — tanpa checkPermission spesifik, akses dikontrol
// dari level parent "Laporan Produksi Garmen" di navbar
router.get("/", verifyToken, controller.getBrowse);

module.exports = router;
