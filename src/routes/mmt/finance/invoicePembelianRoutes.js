const express = require('express');
const router = express.Router();
const controller = require('../../../controllers/mmt/finance/invoicePembelianController.js');
const verifyToken = require('../../../middleware/authMiddleware').verifyToken;

router.get('/next-nomor', verifyToken, controller.getNextNomor);
router.get('/', verifyToken, controller.getInvoiceList);
router.get('/:nomor', verifyToken, controller.getInvoiceByNomor);
router.post('/save', verifyToken, controller.saveInvoice);
router.get('/print/:nomor', verifyToken, controller.printInvoice);
router.delete('/:nomor', verifyToken, controller.deleteInvoice);

module.exports = router;
