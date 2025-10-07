// api/status-auto.js (ESM) — includes payment stages
import { q } from "./_db.js";
import { verifyTelegramInitData } from "./_tg.js";
import { llm } from "./_llm.js";

const SKIP_AUTH = false;

const LABELS = [
  "Talking stage",
  "Awaiting SoW",
  "SoW signed",
  "Awaiting payment",
  "Paid",
  "Preparing campaign",
  "Campaign live",
  "Awaiting report",
  "Campaign finished"
];

function heuristicStatus(texts) {
  const t = texts.join("\n").toLowerCase();
  if (/(sow signed|contract signed|agreement signed|counter-?signed|executed)/.test(t)) return "SoW signed";
  if (/(awaiting payment|waiting .*payment|payment pending|send(ing)? .*invoice|invoice sent)/.test(t)) return "Awaiting payment";
  if (/(payment received|invoice paid|paid\b|funds received|tx confirmed|transaction confirmed)/.test(t)) return "Paid";
  if (/(please sign|sign the sow|sign contract|awaiting sow|waiting for sow)/.test(t)) return "Awaiting SoW";
  if (/(kickoff|kicked off|go live|launch(ed)?|campaign live|started campaign)/.test(t)) return "Campaign live";
  if (/(final report|delivered report|results attached|post-?mortem)/.test(t)) return "Campaign finished";
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
    const limit = Math.min(parseInt(req
