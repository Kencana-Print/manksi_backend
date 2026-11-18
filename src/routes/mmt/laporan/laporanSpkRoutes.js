const express = require("express");
const router = express.Router();
const laporanSpkController = require('../../../controllers/mmt/laporan/laporanSpkController');

router.get("/", laporanSpkController.getReport);

module.exports = router;
