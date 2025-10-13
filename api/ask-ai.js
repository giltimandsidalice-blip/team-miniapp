import { createClient } from "@supabase/supabase-js";
import { llm, scrubPII } from "./_llm.js";

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const supabaseUrl = process.env.DATABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE;

  if (!supabaseUrl || !/^https?:\/\//.test(supabaseUrl)) {
    console.error("[ask-ai] DATABASE_URL is missing or invalid:", supabaseUrl);
    return res.status(500).json({ error: "Supabase client misconfigured (invalid DATABASE_URL)" });
  }

  if (!supabaseKey) {
    console.error("[ask-ai] SUPABASE_SERVICE_ROLE is missing");
    return res.status(500).json({ error: "Supabase client misconfigured (missing service role)" });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  let payload = {};
  try {
    if (!req.body) {
      payload = {};
    } else if (typeof req.body === "string") {
      payload = JSON.parse(req.body);
    } else {
      payload = req.body;
    }
  } catch (e) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const chatId = payload?.chat_id || payload?.chatId;
  const prompt = (payload?.prompt || "").trim();

  if (!chatId || !prompt) {
    return res.status(400).json({ error: "Missing chat_id or prompt" });
  }

  try {
    const { data: messages, error } = await supabase
      .from("messages")
      .select("text")
      .eq("chat_id", chatId)
      .order("date", { ascending: true })
      .limit(400);

    if (error) {
      throw new Error(error.message || "Failed to load messages");
    }

    const chatContent = (messages || [])
      .map((m) => (m?.text || "").trim())
      .filter(Boolean)
      .join("\n")
      .trim();

    const systemPrompt =
      "You are an assistant for the Ad Group team. Answer questions using the supplied Telegram chat transcript.";

    const userPrompt = [
      chatContent
        ? `Chat transcript (scrubbed):\n${scrubPII(chatContent)}`
        : "Chat transcript is empty.",
      "",
      `Question: ${prompt}`,
      "",
      "Reply with a concise answer grounded in the conversation."
    ].join("\n");

    console.log("[ask-ai] ChatID:", chatId);
    console.log("[ask-ai] Prompt:", prompt.slice(0, 100));
    console.log("[ask-ai] Messages found:", messages.length);

    const response = await llm({
      system: systemPrompt,
      user: userPrompt,
      temperature: 0.4,
      max_tokens: 320
    });

    return res.status(200).json({ text: response || "(no response)" });
  } catch (err) {
    console.error("[ask-ai] Error:", err.stack || err);
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    return res.status(status).json({
      error: err?.message || "Server error",
      stage: "llm or supabase"
    });
  }
}
