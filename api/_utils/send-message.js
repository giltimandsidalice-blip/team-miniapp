// api/send-message.js
// Uses BOT_TOKEN_AI (Vercel env) — keeps auth, preview_only, Supabase logging.

import { verifyTelegramInitData } from "./_utils/verifyTelegram.js";
import { logJob } from "./_utils/supabase.js";

export const config = { runtime: "nodejs18.x" };

const BOT_TOKEN = process.env.BOT_TOKEN_AI; // ← renamed env
const TG_BASE = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : "";

/* ----------------------- helpers ----------------------- */
function okJson(res, payload) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}
function errJson(res, code, error, message) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error, message }));
}
function uniqStrings(arr) {
  return [...new Set(arr.map(x => String(x).trim()).filter(Boolean))];
}
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function sendOne(chat_id, text, opts, attempt = 1) {
  const maxAttempts = 3;
  const url = `${TG_BASE}/sendMessage`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id, text, ...opts }),
    });
    const data = await resp.json().catch(() => ({}));

    if (resp.ok && data?.ok) {
      return { chat_id, status: "ok", message_id: data.result?.message_id ?? null };
    }

    const is429 = resp.status === 429 || data?.error_code === 429;
    if (is429 && attempt < maxAttempts) {
      const retryAfter = (data?.parameters?.retry_after || 1) * 1000;
      await new Promise(r => setTimeout(r, retryAfter));
      return sendOne(chat_id, text, opts, attempt + 1);
    }

    return { chat_id, status: "error", error: data?.description || `HTTP ${resp.status}` };
  } catch (e) {
    if (attempt < maxAttempts) {
      await new Promise(r => setTimeout(r, 500 * attempt));
      return sendOne(chat_id, text, opts, attempt + 1);
    }
    return { chat_id, status: "error", error: `network: ${e.message || e}` };
  }
}

async function sendToManyInline({ chatIds, text, parse_mode, disable_notification }) {
  const opts = {};
  if (parse_mode) opts.parse_mode = parse_mode;
  if (typeof disable_notification === "boolean") opts.disable_notification = disable_notification;

  const batches = chunk(chatIds, 5);
  const results = [];
  for (const group of batches) {
    const sent = await Promise.all(group.map(id => sendOne(id, text, opts)));
    results.push(...sent);
  }
  return results;
}

/* ----------------------- handler ----------------------- */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return errJson(res, 405, "METHOD_NOT_ALLOWED", "Use POST");
  }

  const initData = req.headers["x-telegram-init-data"];
  const auth = verifyTelegramInitData(initData);
  if (!auth.ok) {
    return errJson(res, 401, "UNAUTHORIZED", auth.error || "Bad Telegram init data");
  }

  const {
    chat_ids,
    message,
    parse_mode = "HTML",
    disable_notification = false,
    preview_only = false,
  } = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

  if (!Array.isArray(chat_ids) || chat_ids.length === 0) {
    return errJson(res, 400, "INVALID_INPUT", "chat_ids must be a non-empty array");
  }
  if (typeof message !== "string" || message.length < 1 || message.length > 4096) {
    return errJson(res, 400, "INVALID_INPUT", "message must be 1..4096 characters");
  }

  const chatIds = uniqStrings(chat_ids);

  if (preview_only) {
    return okJson(res, {
      preview_only: true,
      total: chatIds.length,
      can_send_count: chatIds.length,
      blocked_or_missing: [],
      notes: "Dry run — no messages sent.",
    });
  }

  if (!BOT_TOKEN) {
    return errJson(res, 500, "SERVER_ERROR", "BOT_TOKEN_AI is not configured");
  }

  try {
    const results = await sendToManyInline({
      chatIds,
      text: message,
      parse_mode,
      disable_notification,
    });

    try {
      await logJob({
        sender_user_id: auth.user?.id ?? null,
        text: message,
        total: chatIds.length,
        results,
      });
    } catch (e) {
      console.warn("logJob failed:", e?.message || e);
    }

    const sent = results.filter(r => r.status === "ok").length;
    const failed = results.length - sent;

    return okJson(res, {
      job_id: null,
      state: "completed",
      total: chatIds.length,
      sent,
      failed,
      results,
    });
  } catch (e) {
    console.error("send-message error:", e);
    return errJson(res, 500, "SERVER_ERROR", e?.message || "Unknown");
  }
}
