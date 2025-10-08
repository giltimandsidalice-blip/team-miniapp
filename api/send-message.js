// api/send-message.js
import { verifyTelegramInitData } from "./_utils/verifyTelegram.js";
import { sendToMany } from "./_utils/sendToTelegram.js";
// (Optional) if you wired it already; otherwise you can delete these 2 lines.
// import { logJob } from "./_utils/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED", message: "Use POST" });
  }

  // 1) Verify Telegram WebApp init data sent by the client
  const initData = req.headers["x-telegram-init-data"];
  const auth = verifyTelegramInitData(initData);
  if (!auth.ok) {
    return res.status(401).json({ error: "UNAUTHORIZED", message: auth.error || "Bad HMAC / initData" });
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
  if (!message || typeof message !== "string" || message.trim().length < 1 || message.length > 4096) {
    return res.status(400).json({ error: "INVALID_INPUT", message: "message must be 1..4096 characters" });
  }

  // 3) Normalize IDs (strings) & uniq
  const chatIds = [...new Set(chat_ids.map(x => String(x).trim()).filter(Boolean))];

  // 4) Dry run for UI preview/tests
  if (preview_only) {
    return res.status(200).json({
      preview_only: true,
      total: chatIds.length,
      can_send_count: chatIds.length,
      blocked_or_missing: [],
      notes: "Dry run — no messages sent.",
    });
  }

  // 5) Bot token
  const botToken = process.env.BOT_TOKEN_AI; // <— your requested name
  if (!botToken) {
    return res.status(500).json({ error: "SERVER_ERROR", message: "BOT_TOKEN_AI is not configured" });
  }

  try {
    // 6) Send
    const results = await sendToMany({
      chatIds,
      text: message,
      parse_mode,
      disable_notification,
      botToken,
    });

    // 7) Aggregate
    const sent   = results.filter(r => r.status === "ok").length;
    const failed = results.length - sent;

    // 8) (Optional) audit log — uncomment if you wired supabase
    // try {
    //   await logJob({
    //     sender_user_id: auth.user?.id ?? null,
    //     text: message,
    //     total: chatIds.length,
    //     results,
    //   });
    // } catch (e) {
    //   console.warn("logJob failed:", e?.message || e);
    // }

    // 9) Return detailed outcome (200 even if some failed)
    return res.status(200).json({
      job_id: null,
      state: "completed",
      total: chatIds.length,
      sent,
      failed,
      results, // [{chat_id,status,description?,http_status?}]
    });
  } catch (e) {
    // If your sender ever throws, surface a useful message
    console.error("send-message error:", e && (e.stack || e));
    const detail =
      e?.telegram_description ||
      e?.message ||
      "Unknown server error";
    return res.status(500).json({ error: "SERVER_ERROR", message: detail });
  }
}
