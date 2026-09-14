const aiChatService = require("../../services/aiChat/aiChatService");
const aiChatHistoryService = require("../../services/aiChat/aiChatHistoryService");

const ALLOWED_KODE = ["DARUL", "DIR", "ADMIN", "RIO", "EDI", "WIDI", "HARIS"];

const checkAccess = (req, res) => {
  const kode = (req.user?.kode || "").toUpperCase();
  if (!ALLOWED_KODE.includes(kode)) {
    res.status(403).json({
      success: false,
      message: "Fitur Asisten AI belum tersedia untuk akun Anda.",
    });
    return false;
  }
  return true;
};

const sendMessage = async (req, res) => {
  try {
    if (!checkAccess(req, res)) return;

    const { message, conversationId } = req.body;
    if (!message || !message.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Pesan tidak boleh kosong." });
    }

    let convId = conversationId;
    let history = [];
    let displayHistory = [];
    let title = null;

    if (convId) {
      const conv = await aiChatHistoryService.getConversation(
        convId,
        req.user.kode,
      );
      history = conv.rawMessages;
      displayHistory = conv.displayMessages;
    } else {
      const created = await aiChatHistoryService.createConversation(
        req.user.kode,
        message,
      );
      convId = created.id;
      title = created.title;
    }

    const result = await aiChatService.sendMessage(message, history, req.user);

    displayHistory.push({ role: "user", text: message });
    displayHistory.push({ role: "assistant", text: result.replyText });

    await aiChatHistoryService.updateConversation(
      convId,
      req.user.kode,
      result.updatedMessages,
      displayHistory,
    );

    res.status(200).json({
      success: true,
      data: {
        reply: result.replyText,
        conversationId: convId,
        title,
      },
    });
  } catch (error) {
    console.error("[aiChat] error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const listConversations = async (req, res) => {
  try {
    if (!checkAccess(req, res)) return;
    const rows = await aiChatHistoryService.listConversations(req.user.kode);
    res.status(200).json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getConversation = async (req, res) => {
  try {
    if (!checkAccess(req, res)) return;
    const conv = await aiChatHistoryService.getConversation(
      req.params.id,
      req.user.kode,
    );
    res.status(200).json({ success: true, data: conv });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const deleteConversation = async (req, res) => {
  try {
    if (!checkAccess(req, res)) return;
    await aiChatHistoryService.deleteConversation(req.params.id, req.user.kode);
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

module.exports = {
  sendMessage,
  listConversations,
  getConversation,
  deleteConversation,
};
