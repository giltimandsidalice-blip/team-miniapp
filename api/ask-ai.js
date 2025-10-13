// /api/ask-ai.js
import { chatComplete } from "./_llm.js";
import { q } from "./_db.js";

const MAX_MESSAGES = 80;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const { chat_id: chatId, prompt } = req.body || {};
  if (!chatId || !prompt) {
    return res.status(400).json({ error: "missing_params" });
  }

  try {
    const { rows } = await q(
      `SELECT text
         FROM messages
        WHERE chat_id = $1
          AND text IS NOT NULL
        ORDER BY date DESC
        LIMIT $2`,
      [chatId, MAX_MESSAGES]
    );

    const chatHistory = rows
      .map(row => row.text)
      .filter(Boolean)
      .reverse()
      .join("\n");

    const systemPrompt =
      "You are an AI assistant helping a team understand a Telegram chat. " +
      "Based on the chat messages, answer the user's question. Be concise and helpful.";

    const aiResponse = await chatComplete({
      system: `${systemPrompt}\n\nChat:\n${chatHistory}`,
      user: prompt,
    });

    return res.status(200).json({ text: aiResponse });
  } catch (err) {
    console.error("ask-ai error:", err);
    return res
      .status(err.status || 500)
      .json({ error: err.message || "failed_to_answer" });
  }
}
