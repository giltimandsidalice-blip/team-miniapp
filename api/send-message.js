// api/send-message.js
import { verifyTelegramInitData } from "./_utils/verifyTelegram.js";
import { sendToMany } from "./_utils/sendToTelegram.js";
import { logJob } from "./_utils/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED", message: "Use POST" });
  }

  // 1) Verify Telegram WebApp init data
  const initData = req.headers["x-telegram-init-data"] || "";
  const auth = verifyTelegramInitData(initData);
  if (!auth.ok) {
    return res.status(401).json({ error: "UNAUTHORIZED", message: auth.error || "Bad Telegram init data" });
  }

  // 2) Read & validate body
  const {
    chat_ids,
    message,
    parse_mode = "HTML",
    disable_notification = false,
    preview_only = false,
  } = req.body || {};

  if (!Array.isArray(chat_ids) || chat_ids.length === 0) {
    return res.status(400).json({ error: "INVALID_INPUT", message: "chat_ids must be a non-empty array" });
  }
  if (typeof message !== "string" || message.length < 1 || message.length > 4096) {
    return res.status(400).json({ error: "INVALID_INPUT", message: "message must be 1..4096 characters" });
  }

  const chatIds = [...new Set(chat_ids.map(x => String(x).trim()).filter(Boolean))];

  if (preview_only) {
    return res.status(200).json({
      preview_only: true,
      total: chatIds.length,
      can_send_count: chatIds.length,
      blocked_or_missing: [],
      notes: "Dry run — no messages sent.",
    });
  }

  // 3) Use ONLY the launching bot token
  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN) {
    return res.status(500).json({ error: "SERVER_ERROR", message: "BOT_TOKEN is not configured" });
  }

  try {
    // 4) Send to Telegram
    const results = await sendToMany({
      chatIds,
      text: message,
      parse_mode,
      disable_notification,
      botToken: BOT_TOKEN,
    });

    // 5) Optional audit log
    try {
      const okCount = results.filter(r => r.status === "ok").length;
      await logJob?.({
        sender_user_id: auth.user?.id ?? null,
        text: message,
        total: chatIds.length,
        results,
        ok_count: okCount,
        fail_count: results.length - okCount,
      });
    } catch (e) {
      console.warn("logJob failed:", e?.message || e);
    }

    const sent = results.filter(r => r.status === "ok").length;
    const failed = results.length - sent;

    return res.status(200).json({
      job_id: null,
      state: "completed",
      total: chatIds.length,
      sent,
      failed,
      results,
    });
  } catch (e) {
    console.error("send-message error:", e);
    return res.status(500).json({ error: "SERVER_ERROR", message: e?.message || "Unknown error" });
  }
}
