// backend/src/routes/pabrik.routes.js
const express = require('express');
const router = express.Router();
const controller = require('../../../controllers/mmt/daftar/lookupPabrikController.js');
const verifyToken = require('../../../middleware/authMiddleware').verifyToken;

router.get('/', verifyToken, controller.getLookup);

module.exports = router;