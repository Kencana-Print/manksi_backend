const aiChatService = require("../../services/aiChat/aiChatService");

const ALLOWED_CABANG = ["HO-"];

const sendMessage = async (req, res) => {
  try {
    if (!ALLOWED_CABANG.includes(req.user.cabang)) {
      return res.status(403).json({
        success: false,
        message: "Fitur Asisten AI belum tersedia untuk cabang Anda.",
      });
    }

    const { message, history } = req.body;
    if (!message || !message.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Pesan tidak boleh kosong." });
    }
    const result = await aiChatService.sendMessage(
      message,
      history || [],
      req.user,
    );
    res.status(200).json({
      success: true,
      data: {
        reply: result.replyText,
        messages: result.updatedMessages,
      },
    });
  } catch (error) {
    console.error("[aiChat] error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { sendMessage };
