const express = require("express");
const router = express.Router();
const controller = require("../../controllers/aiChat/aiChatController");
const { verifyToken } = require("../../middleware/authMiddleware");

router.post("/message", verifyToken, controller.sendMessage);
router.get("/conversations", verifyToken, controller.listConversations);
router.get("/conversations/:id", verifyToken, controller.getConversation);
router.delete("/conversations/:id", verifyToken, controller.deleteConversation);

module.exports = router;
