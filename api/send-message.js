// api/send-message.js
import { verifyTelegramInitData } from "./_utils/verifyTelegram.js";
import { sendToMany } from "./_utils/sendToTelegram.js";
import { logJob } from "./_utils/supabase.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "METHOD_NOT_ALLOWED", message: "Use POST" });
    }

    // Verify Telegram WebApp init data (must be forwarded from the client)
    const initData = req.headers["x-telegram-init-data"];
    const auth = verifyTelegramInitData(initData);
    if (!auth.ok) {
      return res.status(401).json({ error: "UNAUTHORIZED", message: auth.error || "Bad Telegram init data" });
    }

    const {
      chat_ids,
      message,
      parse_mode = "HTML",
      disable_notification = false,
      preview_only = false,
    } = req.body || {};

    // Validate
    if (!Array.isArray(chat_ids) || chat_ids.length === 0) {
      return res.status(400).json({ error: "INVALID_INPUT", message: "chat_ids must be a non-empty array" });
    }
    if (!message || typeof message !== "string" || message.length < 1 || message.length > 4096) {
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

    const botToken = process.env.BOT_TOKEN_AI; // your env name
    if (!botToken) {
      return res.status(500).json({ error: "SERVER_MISCONFIG", message: "BOT_TOKEN_AI is not configured" });
    }

    // Send (never throws)
    const results = await sendToMany({
      chatIds,
      text: message,
      parse_mode,
      disable_notification,
      botToken,
    });

    // Log audit (optional; never throws)
    await logJob({
      sender_user_id: auth.user?.id ?? null,
      text: message,
      total: chatIds.length,
      results,
    });

    const sent = results.filter(r => r.status === "ok").length;
    const failed = results.length - sent;

    return res.status(200).json({
      job_id: null,
      state: "completed",
      total: chatIds.length,
      sent,
      failed,
      results, // includes per-chat httpStatus + Telegram error text if any
    });
  } catch (e) {
    // Surface the real reason to the client so you can see it in the UI
    return res.status(500).json({
      error: "SERVER_ERROR",
      message: e?.message || "Unknown",
    });
  }
}
