const db = require("../../config/database");

const MAX_TITLE_LEN = 50;

const buildTitle = (firstMessage) => {
  const clean = String(firstMessage || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!clean) return "Percakapan Baru";
  return clean.length > MAX_TITLE_LEN
    ? clean.slice(0, MAX_TITLE_LEN) + "..."
    : clean;
};

const createConversation = async (userKode, firstMessage) => {
  const title = buildTitle(firstMessage);
  const [result] = await db.query(
    `INSERT INTO tai_chat_conversation (user_kode, title, raw_messages, display_messages)
     VALUES (?, ?, '[]', '[]')`,
    [userKode, title],
  );
  return { id: result.insertId, title };
};

const listConversations = async (userKode) => {
  const [rows] = await db.query(
    `SELECT id, title, updated_at AS updatedAt
     FROM tai_chat_conversation
     WHERE user_kode = ?
     ORDER BY updated_at DESC
     LIMIT 100`,
    [userKode],
  );
  return rows;
};

const getConversation = async (id, userKode) => {
  const [rows] = await db.query(
    `SELECT id, title, raw_messages AS rawMessages, display_messages AS displayMessages
     FROM tai_chat_conversation
     WHERE id = ? AND user_kode = ?`,
    [id, userKode],
  );
  if (!rows.length) throw new Error("Percakapan tidak ditemukan.");
  const row = rows[0];
  return {
    id: row.id,
    title: row.title,
    rawMessages: JSON.parse(row.rawMessages || "[]"),
    displayMessages: JSON.parse(row.displayMessages || "[]"),
  };
};

const updateConversation = async (
  id,
  userKode,
  rawMessages,
  displayMessages,
) => {
  await db.query(
    `UPDATE tai_chat_conversation
     SET raw_messages = ?, display_messages = ?
     WHERE id = ? AND user_kode = ?`,
    [
      JSON.stringify(rawMessages),
      JSON.stringify(displayMessages),
      id,
      userKode,
    ],
  );
};

const deleteConversation = async (id, userKode) => {
  const [result] = await db.query(
    `DELETE FROM tai_chat_conversation WHERE id = ? AND user_kode = ?`,
    [id, userKode],
  );
  if (result.affectedRows === 0) throw new Error("Percakapan tidak ditemukan.");
};

module.exports = {
  createConversation,
  listConversations,
  getConversation,
  updateConversation,
  deleteConversation,
};
