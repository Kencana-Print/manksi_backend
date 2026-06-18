const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/laporan/marketing/mapBelumRealisasiController");
const { verifyToken } = require("../../../middleware/authMiddleware");

router.get("/", verifyToken, controller.getBrowse);

module.exports = router;
