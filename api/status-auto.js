// api/status-auto.js (ESM) — auto status with forward-only progression
import { q } from "./_db.js";
import { verifyTelegramInitData } from "./_tg.js";

const LABELS = [
  "Talking",
  "Awaiting data",
  "Awaiting SoW",
  "SoW signed",
  "Awaiting payment",
  "Paid",
  "Data collection",
  "Campaign launched",
  "Report awaiting",
  "Finished"
];

const ORDER = Object.fromEntries(LABELS.map((s,i)=>[s,i]));
const SKIP_AUTH = false;

function rank(s){ return (s in ORDER) ? ORDER[s] : 0; }

function heuristicStatus(texts) {
  const t = texts.join("\n").toLowerCase();

  // Strong exact signals (progression)
  if (/\bsigned\b.*\bsow\b|\bsow\b.*\bsigned\b|\bcontract\b.*\bsigned\b/.test(t)) return "SoW signed";
  if (/\bawaiting\b.*\bpayment\b|\bplease (send|share).*invoice|\binvoice (sent|attached)/.test(t)) return "Awaiting payment";
  if (/\bpayment (sent|done|made|completed)|\bpaid\b/.test(t)) return "Paid";
  if (/\bpost(s)? (are )?(loaded|scheduled|queued)|\bcontent (is )?ready|\bbrief( |s)?final/.test(t)) return "Data collection";
  if (/\b(campaign|launch(ed)?|go live|went live|live now)\b/.test(t)) return "Campaign launched";
  if (/\breport (due|pending|awaiting)|\bplease share (the )?report\b/.test(t)) return "Report awaiting";
  if (/\bfinal report (sent|attached|delivered)|\bcampaign (closed|finished|complete)/.test(t)) return "Finished";

  // Medium signals
  if (/\bsow\b/.test(t) && /\b(sign|review|share|draft)\b/.test(t)) return "Awaiting SoW";

  // Early stages
  if (/\bplease provide\b|\bshare the\b.*(geo|budget|kol|creator|platform|language|engagement|brief)/.test(t)) return "Awaiting data";

  return "Talking";
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  // Auth
  try {
    if (!SKIP_AUTH) {
      const initData = req.headers["x-telegram-init-data"] || req.query.init_data || req.body?.init_data || "";
      const ok = verifyTelegramInitData(initData);
      if (!ok) return res.status(401).json({ error: "unauthorized", stage: "auth" });
    }
  } catch (e) {
    return res.status(401).json({ error: `auth_failed: ${e?.message || e}`, stage: "auth" });
  }

  try {
    const chatId = req.query.chat_id;
    const limit = Math.min(parseInt(req.query.limit || "200", 10), 800);
    if (!chatId) return res.status(400).json({ error: "chat_id required" });

    // Pull recent *external* and *team* texts; keep it simple here
    const r = await q(
      `select text, date
         from messages
        where chat_id=$1 and text is not null and is_service=false
        order by date desc
        limit $2`,
      [chatId, limit]
    );
    const texts = (r.rows || []).map(x => String(x.text||"").replace(/\s+/g," ").slice(0,400));

    // Heuristic guess
    let ai = heuristicStatus(texts);

    // Optional LLM refine → snap back to LABELS
    if (process.env.OPENAI_API_KEY && texts.length) {
      try {
        const { llm } = await import("./_llm.js");
        const prompt =
`Choose ONE label from:
${LABELS.join(", ")}

Snippets (latest first):
${texts.join("\n")}

Answer with exactly one label.`;
        const resp = await llm({ system: "Classify status to one exact label.", user: prompt, model: "gpt-4o-mini", temperature: 0 });
        const c = (resp||"").trim();
        if (LABELS.includes(c)) ai = c;
      } catch (_) {}
    }

    // Manual override?
    const m = await q(`select status from chat_status where chat_id=$1`, [chatId]);
    const manual = m.rows[0]?.status || null;

    // Forward-only rule: show the later stage
    let status = ai;
    let source = "auto";
    if (manual) {
      if (rank(ai) > rank(manual)) {
        status = ai; source = "auto_upgrade";
      } else {
        status = manual; source = "manual";
      }
    }

    return res.status(200).json({ chat_id: chatId, status, source, manual: manual || null, ai });
  } catch (e) {
    console.error("status-auto error:", e);
    return res.status(500).json({ error: "server error" });
  }
}
