const express = require("express");
const router = express.Router();
const lapSpkController = require('../../../controllers/mmt/laporan/lapSpkMmtController');

router.get("/", lapSpkController.getReport);

module.exports = router;
