const express = require("express");
const router = express.Router();
const controller = require("../../controllers/piutang/costCenterController");
const { verifyToken } = require("../../middleware/authMiddleware");

router.get("/search", verifyToken, controller.search);

module.exports = router;
