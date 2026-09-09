const Anthropic = require("@anthropic-ai/sdk");

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    "[aiChat] ANTHROPIC_API_KEY belum di-set di .env — fitur chatbot tidak akan berfungsi.",
  );
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  defaultHeaders: {
    // Diperlukan supaya cache_control bisa pakai ttl: "1h" (default
    // tanpa ini cuma 5 menit) — lihat perubahan di aiChatService.js
    "anthropic-beta": "extended-cache-ttl-2025-04-11",
  },
});

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

module.exports = { anthropic, MODEL };
