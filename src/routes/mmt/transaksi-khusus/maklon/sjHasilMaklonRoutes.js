const express = require('express');
const verifyToken = require("../../../../middleware/authMiddleware").verifyToken;
const router = express.Router();
router.use(verifyToken);
const controller = require('../../../../controllers/mmt/transaksi-khusus/maklon/sjHasilMaklonController');

router.get('/outstanding', verifyToken, controller.getOutstanding);
router.get('/available-maklon', verifyToken, controller.getAvailableMaklon);
router.get('/history', verifyToken, controller.getHistory);
router.get('/history/:nomor/detail', verifyToken, controller.getHistoryDetail);
router.get('/create-data', verifyToken, controller.getCreateData);
router.get('/print/:nomor', verifyToken, controller.getPrintData);
router.post('/save', verifyToken, controller.create);

module.exports = router;
