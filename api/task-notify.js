import { verifyTelegramInitData } from "./_utils/verifyTelegram.js";
import { sendToTelegram } from "./_utils/sendToTelegram.js";

export const config = {
  api: {
    bodyParser: true,
  },
};

function sanitizeLine(value) {
  if (!value) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

export default async function handler(req, res) {
  try {
    console.log("🔔 Incoming request to /api/task-notify");

    if (req.method !== "POST") {
      console.warn("❌ Method not allowed:", req.method);
      return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    }

    const botToken = process.env.BOT_TOKEN;
    if (!botToken) {
      console.error("❌ Missing BOT_TOKEN env");
      return res.status(500).json({ error: "SERVER_ERROR", message: "BOT_TOKEN missing" });
    }

    const initDataRaw = req.headers["x-telegram-init-data"];
    if (!initDataRaw) {
      console.warn("❌ Missing Telegram init data header");
      return res.status(401).json({ error: "NO_INIT_DATA" });
    }

    const auth = verifyTelegramInitData(initDataRaw, botToken);
    if (!auth.ok) {
      console.warn("❌ Init data verification failed:", auth.error);
      return res.status(401).json({ error: auth.error || "INVALID_INIT_DATA" });
    }

    const {
      assignee_chat_id,
      assignee_username,
      assignee_display,
      task_text,
      task_id,
      assigner_name,
      assigner_username,
      preview_only = false,
    } = req.body || {};

    if (!assignee_chat_id || !task_text) {
      console.warn("❌ Missing assignee_chat_id or task_text in request body");
      return res.status(400).json({ error: "INVALID_INPUT", message: "assignee_chat_id and task_text are required" });
    }

    const trimmedTask = sanitizeLine(task_text);
    if (!trimmedTask) {
      console.warn("❌ task_text empty after trim");
      return res.status(400).json({ error: "INVALID_INPUT", message: "task_text must not be empty" });
    }

    const lines = [
      "You have a new task!",
    ];

    const cleanAssignerName = sanitizeLine(assigner_name);
    const cleanAssignerHandle = sanitizeLine(assigner_username);
    const cleanAssigneeDisplay = sanitizeLine(assignee_display || assignee_username);

    if (cleanAssignerName || cleanAssignerHandle) {
      const by = [cleanAssignerName, cleanAssignerHandle].filter(Boolean).join(" ");
      lines.push(`Assigned by: ${by}`);
    }

    if (cleanAssigneeDisplay) {
      lines.push(`For: ${cleanAssigneeDisplay}`);
    }

    if (task_id) {
      lines.push(`Task ID: ${sanitizeLine(task_id)}`);
    }

    lines.push("", `Task: ${trimmedTask}`);

    const message = lines.join("\n");

    if (preview_only) {
      console.log("👀 Preview-only mode for task notify");
      return res.status(200).json({ ok: true, preview: true, message, assignee_chat_id });
    }

    try {
      const telegramResponse = await sendToTelegram({
        botToken,
        method: "sendMessage",
        payload: {
          chat_id: assignee_chat_id,
          text: message,
          disable_notification: false,
        },
      });

      console.log("✅ Task notification sent", telegramResponse?.result?.message_id || "(no message id)");

      return res.status(200).json({
        ok: true,
        result: {
          chat_id: assignee_chat_id,
          message_id: telegramResponse?.result?.message_id ?? null,
        },
      });
    } catch (err) {
      const description = err?.message || "Telegram API error";
      console.error("💥 Failed to send task notification:", description);
      return res.status(502).json({ error: "TELEGRAM_ERROR", message: description });
    }
  } catch (err) {
    console.error("💥 UNCAUGHT ERROR in /api/task-notify:", err);
    return res.status(500).json({ error: "SERVER_ERROR", message: err?.message || "Unknown error" });
  }
}
