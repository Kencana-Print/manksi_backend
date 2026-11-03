const express = require('express');
const router = express.Router();
const finishingController = require('../../../controllers/mmt/laporan/lapMonFinishingController');

router.get('/', finishingController.getMonitoringFinishing);

module.exports = router;