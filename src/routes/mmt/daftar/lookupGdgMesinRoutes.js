// src/routes/mmt/daftar/lookupGdgMesinRoutes.js
const express = require("express");
const router = express.Router();
const lookupController = require("../../../controllers/mmt/daftar/lookupGdgMesinController");
const { verifyToken } = require("../../../middleware/authMiddleware");

router.use(verifyToken);

router.get("/gudang", lookupController.getGudangLookup);
router.get("/gudang/:kode", lookupController.getGudangDetail);
router.get("/mesin", lookupController.getMesinCetakLookup);

module.exports = router;

