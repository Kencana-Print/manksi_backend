const { verifyToken } = require("../../../../middleware/authMiddleware");
const express = require("express");
const router = express.Router();
router.use(verifyToken);
const controller = require("../../../../controllers/mmt/transaksi-khusus/map/relationshipMapMmtController");

// Cari dokumen (12 tipe MMT: MAP, SPK, SO, LHK_*, STBJ, JADWAL_KIRIM, SJ): GET /api/mmt/relationship-map/search?type=SPK&q=...
router.get("/search", controller.search);

// Kembangkan graf: GET /api/mmt/relationship-map/expand?type=SPK&nomor=...
router.get("/expand", controller.expand);

module.exports = router;
