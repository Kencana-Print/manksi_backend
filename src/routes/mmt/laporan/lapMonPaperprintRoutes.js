const express = require("express");
const router = express.Router();

const lapMonCetakPaperprintController = require('../../../controllers/mmt/laporan/lapMonPaperprintController');

router.get(
  "/monitoring",
  lapMonCetakPaperprintController.lapMonCetakPaperprint,
);

module.exports = router;
