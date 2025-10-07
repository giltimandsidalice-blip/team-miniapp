// api/status-auto.js — STRICT status detection tailored to TRBE flow (EN/RU)
// Requires: _db.js (ESM), _tg.js, _llm.js in /api
//
// Env (optional):
//   STATUS_WINDOW_DAYS=90           // how far back to consider evidence
//   STATUS_LOG=false                // true to include _debug evidence in response
//   SKIP_AUTH=false                 // true only for local testing
//   TEAM_USERS="@Web3Reachout,@Shefer712,@travalss,@phoebemangoba"  // comma list (with or without @)

import { q } from "./_db.js";
import { verifyTelegramInitData } from "./_tg.js";
import { llm } from "./_llm.js";

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
  "Finished",
];

const DAYS_WINDOW = Number(process.env.STATUS_WINDOW_DAYS || 90);
const INCLUDE_DEBUG = String(process.env.STATUS_LOG || "false").toLowerCase() === "true";
const SKIP_AUTH = String(process.env.SKIP_AUTH || "false").toLowerCase() === "true";

const TEAM_USERS = (process.env.TEAM_USERS || "@Web3Reachout,@Shefer712,@travalss,@phoebemangoba")
  .split(",")
  .map(s => s.trim().replace(/^@/, "").toLowerCase())
  .filter(Boolean);

// -------------------- Patterns (EN + RU) --------------------

const RX = {
  // Team questionnaire message (from TRBE) → moves to Awaiting data
  questionnaireKeys: [
    /geo[-\s]?location.*kol/i,
    /sector\s+focus/i,
    /minimum\s+follower/i,
    /preferred\s+social\s+media/i,
    /content\s+languages?/i,
    /type\s+of\s+engagement/i,
    /budget.*(stablecoin|tokens|usd|usdt|usdc)/i,
    /в(еб)?3/i, // light RU hint is ok
  ],

  // Client provides answers (bulleted/numbered) → we have data
  clientAnswersHints: [
    /^\s*\d+[\).\s-]/im,                           // numbered list lines
    /\b(twitter|x|telegram|tiktok|youtube|reddit)\b/i,
    /\benglish|русский|russian|английский\b/i,
    /\b(kol|influencer|creator)s?\b/i,
    /\b(?:\$|usd|usdt|usdc|sol|eth|btc|k|m)\b/i,   // budgets/amounts
    /\bgeo|tier\s*[12]\b/i,
  ],

  // SoW progression
  awaitingSoWFromTeam: [
    /\b(we'?ll|we\s+will|we\s+will\s+prepare|we\s+will\s+share)\b.*\b(statement\s+of\s+work|sow)\b/i,
    /\bподготов(им|им\s+и\s+вышлем)\b.*\b(sow|договор|контракт|соглашение)\b/i,
    /\bplease\b.*\b(name|email)\b.*(sign.*sow|signer)/i,
    /\bпросим\b.*\b(имя|email|почту)\b.*\bдля\s+подписания\b/i,
    /\battaching\b.*\b(sow|statement of work)\b/i,
    /\bв(ышла|ыкладыва)ю\b.*\b(sow|договор)\b/i,
  ],

  sowSigned: [
    /\b(sow|statement\s+of\s+work|contract|agreement)\b.*\b(signed|countersigned|executed|fully\s+signed)\b/i,
    /\bподписан(о|а)?\b.*\b(договор|контракт|соглашение|sow)\b/i,
    /\bспасибо\b.*\bза\b.*\bподписан/i,
  ],

  // Payment (very strict, optional stage between SoW signed and Data collection)
  paidFalseContext: [
    /\bpaid\s+(plan|tier|version|subscription|feature|media|promotion|ads?|traffic|users?)\b/i,
    /\bплатн(ая|ые|ый)\s+(версия|подписка|реклама|продвижение|медиа|тариф)\b/i,
  ],
  awaitingPayment: [
    /\b(invoice|payment|wire|bank\s*transfer|remittance|tx|transaction)\b.*\b(sent|issued|shared|awaiting|pending|due|pay|settle|payment\s+details)\b/i,
    /\bplease\s+(pay|wire|transfer|settle|remit)\b/i,
    /\bсчет\b.*\b(выслан|отправил|отправили|выслали|выставлен|выставили)\b/i,
    /\bжд(ём|ем)\b.*\b(оплаты|платежа)\b/i,
    /\bпросим\b.*\b(оплатить|перевести)\b/i,
    /\bреквизиты\b.*\b(оплаты|для\s+оплаты|для\s+перевода)\b/i,
  ],
  paidStrong: [
    /\b(payment|wire|transfer|remittance|funds|tx|transaction|usdt|usdc|crypto)\b.*\b(received|confirmed|credited|landed|settled|cleared)\b/i,
    /\b(invoice)\b.*\b(paid|settled)\b/i,
    /\bpayment\b.*\bconfirmed\b/i,
    /\bоплата\b.*\b(получен[аы]?|поступил[аи]?|подтвержден[аы]?|зачислен[аы]?|проведена)\b/i,
    /\bсчет\b.*\b(оплачен|закрыт)\b/i,
    /\bденьги\b.*\b(пришл[и]?|поступил[аи]?)\b/i,
    /\bплатеж\b.*\b(прошел|проведен)\b/i,
    /\btx\b.*\bconfirmed\b/i,
  ],
  paymentNegation: [
    /\b(not|hasn'?t|haven'?t|no)\s+(yet\s+)?(paid|received|landed|credited|confirmed|arrived)\b/i,
    /\bоплата\b.*\b(не\s+получен[аы]?|еще\s+нет|не\s+поступил[аи]?|не\s+подтвержден[аы]?)\b/i,
    /\bждем\b.*\bоплат[уы]\b/i,
  ],

  // Data collection (post-SoW back-and-forth about KOLs/creatives/etc.)
  dataCollection: [
    /\b(kol|influencer|creator|shortlist|list|brief|creative|asset|visual|guideline|content\s+plan|deliverables?)\b/i,
    /\bбриф\b|\bкреатив(ы)?\b|\bвизуал(ы)?\b|\bгайдлайн(ы)?\b|\bподбор\b.*(кол|инфлуенсер)/i,
  ],

  // Launch
  campaignLaunched: [
    /\bposts?\s+(are\s+)?loaded\s+on\s+the\s+platform\b/i,
    /\bcheck\s+the\s+platform\b/i,
    /\bit'?s\s+on\s+the\s+platform\b/i,
    /\bcampaign\s+launched\b/i,
    /\bкампания\b.*\bзапущен[аы]?\b/i,
    /\bпост(ы)?\b.*\bзагружен(ы)?\s+на\s+платформ/iu,
  ],

  // Report awaiting
  reportAwaiting: [
    /\b(last|final)\s+posts?\b.*\b(published|going\s+out|went\s+out)\b/i,
    /\bwe'?ll?\s+(soon\s+)?provide\s+(the\s+)?(campaign\s+)?report\b/i,
    /\bскоро\b.*\bотчет\b/i,
    /\bпоследн(ий|ие)\s+пост(ы)?\b.*\bвышли\b/i,
  ],

  // Finished (report delivered)
  finished: [
    /\b(sent|attached|shared)\b.*\b(report|final\s+report)\b/i,
    /\bотправил(и)?\b.*\bотчет\b/i,
    /\bфинальн(ый|ый\s+отчет|ый\s+отчёт)\b.*\b(отправил|приложил|поделил[си][сь])\b/i,
    /\breport\b.*\b(link|attached|delivered)\b/i,
  ],
};

// -------------------- Helpers --------------------

const normalizeUsername = (u) => (u || "").replace(/^@/, "").toLowerCase();
const isTeamUser = (u) => !!u && TEAM_USERS.includes(normalizeUsername(u));

const anyMatch = (patterns, s) => patterns.some((re) => re.test(s));

function analyze(rows) {
  const ev = {
    questionnaireSent: false,
    clientProvidedData: false,

    awaitingSoW: false,
    sowSigned: false,

    awaitingPayment: false,
    paidStrong: false,
    paymentNegation: false,

    dataCollection: false,
    campaignLaunched: false,
    reportAwaiting: false,
    finished: false,

    prepayment: false,

    ts: {},
  };

  const setHit = (k, d) => {
    ev[k] = true;
    if (!ev.ts[k] || d > ev.ts[k]) ev.ts[k] = d;
  };

  for (const r of rows) {
    const t = String(r.text || "");
    const d = new Date(r.date).getTime();
    const uname = normalizeUsername(r.username);

    // Questionnaire only counts when sent by TRBE team
    if (isTeamUser(uname)) {
      const hits = RX.questionnaireKeys.reduce((n, re) => (re.test(t) ? n + 1 : n), 0);
      if (hits >= 3) setHit("questionnaireSent", d);

      if (anyMatch(RX.awaitingSoWFromTeam, t)) setHit("awaitingSoW", d);
    } else {
      // Client answers
      const answers = RX.clientAnswersHints.reduce((n, re) => (re.test(t) ? n + 1 : n), 0);
      if (answers >= 2) setHit("clientProvidedData", d);
    }

    if (anyMatch(RX.sowSigned, t)) setHit("sowSigned", d);

    // Payment (block false “paid media/plan”)
    if (!anyMatch(RX.paidFalseContext, t) && anyMatch(RX.awaitingPayment, t)) setHit("awaitingPayment", d);
    if (!anyMatch(RX.paidFalseContext, t) && anyMatch(RX.paidStrong, t)) setHit("paidStrong", d);
    if (anyMatch(RX.paymentNegation, t)) setHit("paymentNegation", d);
    if (/\bpre-?payment|advance\s+payment|deposit|предоплат(а|у|ой)\b/i.test(t)) setHit("prepayment", d);

    // Data/launch/report/finish
    if (anyMatch(RX.dataCollection, t)) setHit("dataCollection", d);
    if (anyMatch(RX.campaignLaunched, t)) setHit("campaignLaunched", d);
    if (anyMatch(RX.reportAwaiting, t)) setHit("reportAwaiting", d);
    if (anyMatch(RX.finished, t)) setHit("finished", d);
  }
  return ev;
}

function pickStatus(ev) {
  // Payment guards
  const paidAllowed =
    ev.paidStrong &&
    !(ev.paymentNegation && ev.ts.paymentNegation && ev.ts.paidStrong && ev.ts.paymentNegation > ev.ts.paidStrong);

  const awaitingPayAllowed =
    ev.awaitingPayment &&
    !(ev.paidStrong && ev.ts.paidStrong && ev.ts.awaitingPayment && ev.ts.paidStrong > ev.ts.awaitingPayment);

  const sowGate = ev.sowSigned || ev.prepayment;

  // Terminal phases first
  if (ev.finished) return "Finished";
  if (ev.reportAwaiting) return "Report awaiting";
  if (ev.campaignLaunched) return "Campaign launched";

  // Data collection after SoW signed (and before launch)
  if (ev.sowSigned && ev.dataCollection && !ev.campaignLaunched) return "Data collection";

  // Payments (optional ladder between SoW signed and Data collection)
  if (sowGate && paidAllowed) return "Paid";
  if (sowGate && awaitingPayAllowed) return "Awaiting payment";

  // Contract ladder
  if (ev.sowSigned) return "SoW signed";
  if (ev.awaitingSoW || (ev.clientProvidedData && ev.questionnaireSent)) return "Awaiting SoW";

  // Pre-contract discovery
  if (ev.questionnaireSent && !ev.clientProvidedData) return "Awaiting data";

  // Start
  return "Talking";
}

// -------------------- HTTP Handler --------------------

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  // Telegram auth
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
    return res.status(401).json({ error: `auth_failed: ${e?.message || e}`, stage: "auth" });
  }

  try {
    const chatId = req.query.chat_id;
    const limit = Math.min(parseInt(req.query.limit || "500", 10), 1000);
    if (!chatId) return res.status(400).json({ error: "chat_id required" });

    // Pull recent messages INCLUDING team (we need to see TRBE prompts + client answers)
    const { rows } = await q(
      `
      SELECT m.text, m.date, u.username
      FROM messages m
      LEFT JOIN tg_users u ON u.id = m.sender_id
      WHERE m.chat_id = $1
        AND m.text IS NOT NULL
        AND m.date > now() - interval '${DAYS_WINDOW} days'
      ORDER BY m.date DESC
      LIMIT $2
      `,
      [chatId, limit]
    );

    if (!rows.length) {
      return res.status(200).json({ status: "Talking", samples_used: 0, window_days: DAYS_WINDOW });
    }

    const ev = analyze(rows);
    let status = pickStatus(ev);

    // Optional tiny LLM nudge for non-money, non-terminal ambiguity (kept very constrained)
    if (process.env.OPENAI_API_KEY && rows.length >= 12) {
      try {
        if (!["Paid", "Awaiting payment", "Finished"].includes(status)) {
          const snippets = rows
            .slice(0, 120)
            .map(r => (r.text || "").replace(/\s+/g, " ").slice(0, 280))
            .join("\n");

          const prompt = `Choose ONE label ONLY from: ${LABELS.join(
            ", "
          )}. Output EXACTLY the label.\n\nRules:\n- Respect this ladder: Talking → Awaiting data → Awaiting SoW → SoW signed → (Awaiting payment → Paid) → Data collection → Campaign launched → Report awaiting → Finished.\n- "Awaiting data" = team questionnaire sent but client hasn't answered yet.\n- "Awaiting SoW" = client answered the questionnaire and team is sending/preparing SoW.\n- "Data collection" = after SoW signed, we're aligning KOLs/brief/visuals before launch.\n- "Campaign launched" = messages like “posts are loaded on the platform / check the platform / it’s on the platform”.\n- "Report awaiting" = last/final posts are out and report is pending soon.\n- "Finished" = report explicitly sent/attached/shared.\n- For "Awaiting payment"/"Paid", do **NOT** decide unless explicit invoice/payment messages exist; otherwise choose a non-payment label.\n- Prefer recency, last ${DAYS_WINDOW} days. English output only.\n\nSnippets (latest first):\n${snippets}`;

          const ans = (await llm({
            system: "English only. Return just the label exactly as listed.",
            user: prompt,
            model: "gpt-4o-mini",
            max_tokens: 8,
            temperature: 0,
          })).trim();

          if (LABELS.includes(ans)) {
            // Keep payment hard gates
            if (ans === "Paid" || ans === "Awaiting payment") {
              // ignore — guarded above
            } else {
              status = ans;
            }
          }
        }
      } catch {
        // ignore refinement errors
      }
    }

    const out = { status, samples_used: rows.length, window_days: DAYS_WINDOW };
    if (INCLUDE_DEBUG) out._debug = { TEAM_USERS, ev };
    return res.status(200).json(out);
  } catch (e) {
    console.error("status-auto error:", e);
    return res.status(500).json({ error: "server error" });
  }
}
