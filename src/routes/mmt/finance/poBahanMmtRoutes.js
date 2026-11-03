const express = require('express');
const router = express.Router();

const controller = require('../../../controllers/mmt/finance/poBahanMmtController');
const verifyToken = require("../../../middleware/authMiddleware").verifyToken;

/* =========================
   SEMUA ROUTE WAJIB LOGIN
========================= */
router.use(verifyToken);

/* =========================
   ROUTE KHUSUS (HARUS DI ATAS)
========================= */

// lookup PO
router.get('/po/lookup', controller.lookupPO);
router.get('/po/lookup/:nomor', controller.getPODetail);

// load MKB
router.get('/load-mkb/:nomor', controller.loadMkbDetail);

// print
router.get('/print/:nomor', controller.getPoDataForPrint);

// MB detail
router.get('/unfulfilled-mb-detail/:mbNomor', controller.getUnfulfilledMbDetail);

// detail by query
router.get('/detail', controller.getDetailsPO);

// ACC Manager
router.put('/:nomor/acc-manager', controller.accManagerPO);

// toggle close
router.put('/:nomor/toggle-close', controller.toggleClose);


/* =========================
   CRUD PO
========================= */

// browse
router.get('/', controller.browsePO);

// get by nomor (EDIT)
router.get('/:nomor', controller.getPOById);

// insert
router.post('/', controller.savePO);

// update
router.put('/:nomor', controller.savePO);

// delete
router.delete('/:nomor', controller.deletePO);

module.exports = router;
