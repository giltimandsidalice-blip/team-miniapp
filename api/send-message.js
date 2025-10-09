import { verifyTelegramInitData } from "./_utils/verifyTelegram.js";
import { sendToTelegram } from "../_utils/sendToTelegram.js";

// 👇 This is optional but helps Vercel know the body should be parsed
export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  try {
    console.log("📨 Incoming request to /api/send-message");

    if (req.method !== "POST") {
      console.warn("❌ Method not allowed:", req.method);
      return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    }

    const botToken = process.env.BOT_TOKEN;
    if (!botToken) {
      console.error("❌ Missing BOT_TOKEN");
      return res.status(500).json({ error: "SERVER_ERROR", message: "BOT_TOKEN missing" });
    }
    console.log("✅ BOT_TOKEN is defined, last 6 chars:", botToken.slice(-6));

    const initDataRaw = req.headers["x-telegram-init-data"];
    if (!initDataRaw) {
      console.warn("❌ No init data received");
      return res.status(401).json({ error: "NO_INIT_DATA" });
    }

    console.log("🔐 Verifying Telegram init data...");
    const auth = verifyTelegramInitData(initDataRaw, botToken);

    if (!auth.ok) {
      console.warn("❌ HMAC verification failed:", auth.error);
      return res.status(401).json({ error: auth.error });
    }
    console.log("✅ HMAC verified");

    console.log("📦 Parsing request body");
    const { chat_ids, message, parse_mode = "HTML", disable_notification = false, preview_only = false } = req.body || {};

    if (!chat_ids?.length || !message) {
      console.warn("❌ Missing chat_ids or message in request body");
      return res.status(400).json({ error: "INVALID_INPUT", message: "chat_ids and message are required" });
    }

    if (preview_only) {
      console.log("👀 Preview-only mode");
      return res.status(200).json({ ok: true, preview: true, chat_ids, message });
    }

    console.log("📤 Sending message to", chat_ids.length, "chat(s)");

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

    console.log("📬 Message results:", results);

    const response = results.map((r, i) => ({
      chat_id: chat_ids[i],
      status: r.status === "fulfilled" && r.value.ok ? "sent" : "fail",
      error: r.status === "rejected" ? r.reason?.message : r.value?.description || null,
    }));

    return res.status(200).json({ ok: true, results: response });
  } catch (err) {
    console.error("💥 UNCAUGHT ERROR in /api/send-message:", err);
    return res.status(500).json({ error: "SERVER_ERROR", message: err.message || "Unknown error" });
  }
}
