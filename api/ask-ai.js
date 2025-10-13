// api/ask-ai.js
import { createClient } from "@supabase/supabase-js";
import { llm, scrubPII } from "./_llm.js";

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // 🔍 Diagnostic logging
  console.log("[ask-ai] env.DATABASE_URL:", process.env.DATABASE_URL);
  console.log("[ask-ai] env.SUPABASE_SERVICE_ROLE:", process.env.SUPABASE_SERVICE_ROLE);

  const supabaseUrl = process.env.DATABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE;

  // Validate Supabase credentials
  if (!supabaseUrl || !supabaseUrl.startsWith("http")) {
    console.error("[ask-ai] Supabase misconfigured — URL:", supabaseUrl);
    return res.status(500).json({ error: "Supabase client misconfigured (invalid DATABASE_URL)" });
  }

  if (!supabaseKey) {
    console.error("[ask-ai] Supabase misconfigured — missing SUPABASE_SERVICE_ROLE");
    return res.status(500).json({ error: "Supabase client misconfigured (missing key)" });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Parse request body
  const { chat_id, prompt } = req.body || {};
  if (!chat_id || !prompt) {
    return res.status(400).json({ error: "Missing chat_id or prompt" });
  }

  try {
    // Fetch recent messages from Supabase
    const { data: messages, error } = await supabase
      .from("messages")
      .select("role, content")
      .eq("chat_id", chat_id)
      .order("created_at", { ascending: true })
      .limit(100);

    if (error) {
      console.error("[ask-ai] Supabase fetch error:", error.message);
      return res.status(500).json({ error: "Failed to fetch messages", stage: "fetch" });
    }

    const system = `You are an assistant helping a Telegram-based team manage chat projects. Respond based only on the given chat history and prompt.`;
    const userInput = `Chat history:\n\n${messages.map(m => `${m.role}: ${m.content}`).join("\n")}\n\nPrompt: ${prompt}`;

    const output = await llm({ system, user: userInput });

    return res.status(200).json({ text: output });

  } catch (err) {
    console.error("[ask-ai] Unexpected error:", err);
    return res.status(500).json({ error: "Unknown error", details: err?.message || String(err) });
  }
}
