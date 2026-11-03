const express = require("express");
const router = express.Router();
const lapLhkController = require('../../../controllers/mmt/laporan/lapLhkController');

// ==========================================
// RUTE LAPORAN & AGREGASI LHK (READ-ONLY)
// ==========================================

// 1. Ringkasan Statistik untuk Dashboard
// Endpoint: GET /api/lap-lhk/agregasi?startDate=2026-08-01&endDate=2026-08-31
router.get("/agregasi", lapLhkController.getLaporanAgregasi);

// 2. Rekap Tabel LHK (Per Mesin & Harian)
// Endpoint: GET /api/lap-lhk/rekap?startDate=2026-08-01&endDate=2026-08-31
router.get("/rekap", lapLhkController.getRekapLhk);

// 3. Export Excel CrossTab (Mesin vs Hari/Tanggal)
// Endpoint: GET /api/lap-lhk/crosstab?month=8&year=2026
router.get("/crosstab", lapLhkController.getExportLhkCrossTab);

// 4. Export Data Detail Lengkap
// Endpoint: GET /api/lap-lhk/export?startDate=2026-08-01&endDate=2026-08-31&mesin=SB01,MMT01
router.get("/export", lapLhkController.getAllDataForExport);

// 5. Detail Rekap Pengerjaan Per Mesin Spesifik
// Endpoint: GET /api/lap-lhk/detail-mesin?startDate=2026-08-01&endDate=2026-08-31&mesin=SB01
router.get("/detail-mesin", lapLhkController.getDetailRekapMesin);

module.exports = router;
