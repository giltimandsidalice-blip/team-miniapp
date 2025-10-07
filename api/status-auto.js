// api/status-auto.js (ESM)
import { q } from "./_db.js";
import { verifyTelegramInitData } from "./_tg.js";
import { llm } from "./_llm.js";

const SKIP_AUTH = false;

const LABELS = [
  "Talking stage",
  "Awaiting SoW",
  "SoW signed",
  "Preparing campaign",
  "Campaign live",
  "Awaiting report",
  "Campaign finished"
];

function heuristicStatus(texts) {
  const t = texts.join("\n").toLowerCase();
  if (/sow signed|contract signed|agreement signed|counter-signed|executed/.test(t)) return "SoW signed";
  if (/(please sign|sign the sow|sign contract|awaiting sow|waiting for sow)/.test(t)) return "Awaiting SoW";
  if (/(kickoff|kicked off|go live|launch(ed)?|campaign live|started campaign)/.test(t)) return "Campaign live";
  if (/(final report|delivered report|results attached|post-mortem)/.test(t)) return "Campaign finished";
  if (/(report due|waiting for report|awaiting report)/.test(t)) return "Awaiting report";
  if (/(kol|influencer|creator).*(list|shortlist|select|choos)/.test(t)) return "Preparing campaign";
  return "Talking stage";
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  try {
    if (!SKIP_AUTH) {
      const initData =
        req.headers["x-telegram-init-data"] ||
        req.query.init_data ||
        req.body?.init_data ||
        "";
      const ok = verifyTelegramInitData(initData);
      if (!ok) return res.status(401).json({ error: "unauthorized", stage: "auth" });
    }
  } catch (e) {
    return res.status(401).json({ error:`auth_failed: ${e?.message||e}`, stage:"auth" });
  }

  try {
    const chatId = req.query.chat_id;
    const limit = Math.min(parseInt(req.query.limit || "200", 10), 800);
    if (!chatId) return res.status(400).json({ error: "chat_id required" });

    const { rows } = await q(
      `SELECT text, date
         FROM v_messages_non_team
        WHERE chat_id=$1 AND text IS NOT NULL
        ORDER BY date DESC
        LIMIT $2`,
      [chatId, limit]
    );
    const texts = rows.map(r => (r.text || "").replace(/\s+/g, " ").slice(0, 400));

    let guess = heuristicStatus(texts);

    if (process.env.OPENAI_API_KEY && texts.length) {
      const prompt =
`You are an ops assistant. Choose ONE status label ONLY from this set (respond with just the label):
${LABELS.join(", ")}

Definitions:
- Talking stage — general discussion, no SoW mentioned.
- Awaiting SoW — asked to sign/confirm SoW/contract.
- SoW signed — explicit confirmation SoW/contract is signed.
- Preparing campaign — KOLs/creatives/briefs before launch.
- Campaign live — launched or running.
- Awaiting report — report requested/pending.
- Campaign finished — final report delivered / closed.

Snippets (latest first):
${texts.slice(0,120).join("\n")}
`;
      try {
        const raw = await llm({ system: "English only.", user: prompt, model: "gpt-4o-mini", temperature: 0 });
        const ans = (raw || "").trim();
        if (LABELS.includes(ans)) guess = ans;
      } catch {
        // ignore; keep heuristic
      }
    }

    res.status(200).json({ status: guess, samples_used: texts.length });
  } catch (e) {
    console.error("status-auto error:", e);
    res.status(500).json({ error: "server error" });
  }
}
