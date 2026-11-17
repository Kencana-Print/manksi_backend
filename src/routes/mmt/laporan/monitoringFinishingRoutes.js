const express = require('express');
const router = express.Router();
const finishingController = require('../../../controllers/mmt/laporan/monitoringFinishingController');

router.get('/', finishingController.getMonitoringFinishing);

module.exports = router;