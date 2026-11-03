const { verifyToken } = require("../../../../middleware/authMiddleware");
const express = require('express');
const router = express.Router();
router.use(verifyToken);
const controller = require('../../../../controllers/mmt/transaksi-khusus/spk-order/penerimaanPoExtMmtController');

router.get('/', controller.browse);
router.get('/:nomor', controller.getById);
router.post('/', controller.save);
router.put('/:nomor', controller.save);
router.delete('/:nomor', controller.remove);

module.exports = router;