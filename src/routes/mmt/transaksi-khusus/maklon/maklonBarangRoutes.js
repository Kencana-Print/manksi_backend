const express = require('express');
const verifyToken = require("../../../../middleware/authMiddleware").verifyToken;
const router = express.Router();
router.use(verifyToken);
const controller = require('../../../../controllers/mmt/transaksi-khusus/maklon/maklonBarangController');

// Browse, detail, print, lookup
router.get('/browse', verifyToken, controller.getBrowse);
router.get('/detail/:nomor', verifyToken, controller.getDetail);
router.get('/print/:nomor', verifyToken, controller.getPrintData);
router.get('/sj-keluar/print/:sjkNomor', verifyToken, controller.getSjKeluarPrintData);
router.get('/lookup', verifyToken, controller.getLookup);

module.exports = router;
