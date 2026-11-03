const { verifyToken } = require("../../../middleware/authMiddleware");
// backend/src/routes/operatorMmt.routes.js

const express = require('express');
const router = express.Router();
router.use(verifyToken);
const controller = require('../../../controllers/mmt/daftar/operatorController');
 

// GET /api/mmt/operator/browse (btnRefreshClick)
router.get(`/`, controller.getOperators);

// GET /api/mmt/operator/:kode (untuk Edit)
router.get(`/:kode`, controller.getOperatorByKode);

// POST /api/mmt/operator/save (New/Edit Save)
router.post(`/save`, controller.saveOperator);

// DELETE /api/mmt/operator/:kode (cxButton4Click)
router.delete(`/:kode`, controller.deleteOperator);

module.exports = router;