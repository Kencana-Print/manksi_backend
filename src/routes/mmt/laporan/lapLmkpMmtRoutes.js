const express = require('express');
const router = express.Router();
const lmkpController = require('../../../controllers/mmt/laporan/lapLmkpMmtController');
const { verifyToken, checkPermission } = require('../../../middleware/authMiddleware');

// Endpoint: GET /api/laporan/lmkp?jenisIndex=0&startDate=2023-01-01&endDate=2023-01-31
// 1. verifyToken     -> wajib login (JWT)
// 2. checkPermission -> wajib centang hak akses menu 1308 (LMKP) di grid Management User
//    (deny-by-default: tanpa baris di thakuser -> 403)
const MENU_ID_LMKP = 1308; // tmenu: frmlap_lmkp_mmt "Laporan Kekurangan Produksi MMT"

router.get(
  '/lmkp',
  verifyToken,
  checkPermission(MENU_ID_LMKP, 'view'),
  lmkpController.getLaporan
);

module.exports = router;