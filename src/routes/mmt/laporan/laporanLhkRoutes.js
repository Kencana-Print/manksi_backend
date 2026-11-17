const express = require("express");
const router = express.Router();
const laporanLhkController = require('../../../controllers/mmt/laporan/laporanLhkController');

// ==========================================
// RUTE LAPORAN & AGREGASI LHK (READ-ONLY)
// ==========================================

// 1. Ringkasan Statistik untuk Dashboard
// Endpoint: GET /api/lap-lhk/agregasi?startDate=2026-08-01&endDate=2026-08-31
router.get("/agregasi", laporanLhkController.getLaporanAgregasi);

// 2. Rekap Tabel LHK (Per Mesin & Harian)
// Endpoint: GET /api/lap-lhk/rekap?startDate=2026-08-01&endDate=2026-08-31
router.get("/rekap", laporanLhkController.getRekapLhk);

// 3. Export Excel CrossTab (Mesin vs Hari/Tanggal)
// Endpoint: GET /api/lap-lhk/crosstab?month=8&year=2026
router.get("/crosstab", laporanLhkController.getExportLhkCrossTab);

// 4. Export Data Detail Lengkap
// Endpoint: GET /api/lap-lhk/export?startDate=2026-08-01&endDate=2026-08-31&mesin=SB01,MMT01
router.get("/export", laporanLhkController.getAllDataForExport);

// 5. Detail Rekap Pengerjaan Per Mesin Spesifik
// Endpoint: GET /api/lap-lhk/detail-mesin?startDate=2026-08-01&endDate=2026-08-31&mesin=SB01
router.get("/detail-mesin", laporanLhkController.getDetailRekapMesin);

module.exports = router;
