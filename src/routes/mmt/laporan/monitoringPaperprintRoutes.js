const express = require("express");
const router = express.Router();

const monitoringPaperprintController = require('../../../controllers/mmt/laporan/monitoringPaperprintController');

router.get(
  "/monitoring",
  monitoringPaperprintController.lapMonCetakPaperprint,
);

module.exports = router;
