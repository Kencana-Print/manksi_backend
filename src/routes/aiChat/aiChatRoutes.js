const express = require("express");
const router = express.Router();
const controller = require("../../controllers/aiChat/aiChatController");
const { verifyToken } = require("../../middleware/authMiddleware");

router.post("/message", verifyToken, controller.sendMessage);

module.exports = router;
