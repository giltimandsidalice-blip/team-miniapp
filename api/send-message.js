// api/send-message.js
import { verifyTelegramInitData } from "./_utils/verifyTelegram.js";
import { sendToMany } from "./_utils/sendToTelegram.js";
import { logJob } from "./_utils/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED", message: "Use POST" });
  }

  // Verify Telegram WebApp init data (from your UI fetch headers)
  const initData = req.headers["x-telegram-init-data"];
  const auth = verifyTelegramInitData(initData);
  if (!auth.ok) {
    return res.status(401).json({ error: "UNAUTHORIZED", message: auth.error || "Bad Telegram init data" });
  }

  // Read body
  const {
    chat_ids,
    message,
    parse_mode = "HTML",
    disable_notification = false,
    preview_only = false,
  } = req.body || {};

  // Validate input
  if (!Array.isArray(chat_ids) || chat_ids.length === 0) {
    return res.status(400).json({ error: "INVALID_INPUT", message: "chat_ids must be a non-empty array" });
  }
  if (!message || typeof message !== "string" || message.length < 1 || message.length > 4096) {
    return res.status(400).json({ error: "INVALID_INPUT", message: "message must be 1..4096 characters" });
  }

  // Normalize & uniq IDs
  const chatIds = [...new Set(chat_ids.map(x => String(x).trim()).filter(Boolean))];

  // Dry-run mode (useful for UI preview/tests)
  if (preview_only) {
    return res.status(200).json({
      preview_only: true,
      total: chatIds.length,
      can_send_count: chatIds.length,
      blocked_or_missing: [],
      notes: "Dry run — no messages sent.",
    });
  }

  if (!process.env.BOT_TOKEN) {
    return res.status(500).json({ error: "SERVER_ERROR", message: "BOT_TOKEN is not configured" });
  }

  try {
    // Send synchronously (reliable for small/medium batches)
    const results = await sendToMany({
      chatIds,
      text: message,
      parse_mode,
      disable_notification,
      botToken: process.env.BOT_TOKEN,
    });

    // Optional audit log (no-op unless you wire SUPABASE envs)
    try {
      await logJob({
        sender_user_id: auth.user?.id ?? null,
        text: message,
        total: chatIds.length,
        results,
      });
    } catch (e) {
      // Don't fail the request if logging fails
      console.warn("logJob failed:", e?.message || e);
    }

    const ok = results.filter(r => r.status === "ok").length;
    const failed = results.length - ok;

    return res.status(200).json({
      job_id: null,       // synchronous send (no queue/job)
      state: "completed",
      total: chatIds.length,
      sent: ok,
      failed,
      results,
    });
  } catch (e) {
    console.error("send-message error:", e);
    return res.status(500).json({ error: "SERVER_ERROR", message: e?.message || "Unknown" });
  }
}
