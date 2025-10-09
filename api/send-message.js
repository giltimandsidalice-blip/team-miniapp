import { verifyTelegramInitData } from "../_utils/verifyTelegram.js";
import { sendToTelegram } from "../_utils/sendToTelegram.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  }

  const botToken = process.env.BOT_TOKEN;
  if (!botToken) {
    return res.status(500).json({ error: "SERVER_ERROR", message: "BOT_TOKEN missing" });
  }

  const initDataRaw = req.headers["x-telegram-init-data"];
  const auth = verifyTelegramInitData(initDataRaw, botToken);

  if (!auth.ok) {
    console.warn("Auth failed:", auth.error);
    return res.status(401).json({ error: auth.error });
  }

  const { chat_ids, message, parse_mode = "HTML", disable_notification = false, preview_only = false } = req.body || {};

  if (!chat_ids?.length || !message) {
    return res.status(400).json({ error: "INVALID_INPUT", message: "chat_ids and message are required" });
  }

  if (preview_only) {
    return res.status(200).json({ ok: true, preview: true, chat_ids, message });
  }

  const results = await Promise.allSettled(
    chat_ids.map(chat_id =>
      sendToTelegram({
        botToken,
        method: "sendMessage",
        payload: {
          chat_id,
          text: message,
          parse_mode,
          disable_notification,
        },
      })
    )
  );

  const response = results.map((r, i) => ({
    chat_id: chat_ids[i],
    status: r.status === "fulfilled" && r.value.ok ? "sent" : "fail",
    error: r.status === "rejected" ? r.reason?.message : r.value?.description || null,
  }));

  return res.status(200).json({ ok: true, results: response });
}
