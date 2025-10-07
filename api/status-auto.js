// api/status-auto.js — STRICT evidence-gated status detection (EN/RU)
// Requires: _db.js (ESM), _tg.js, _llm.js present in /api
// Env (optional):
//   STATUS_WINDOW_DAYS=60        // how far back to look
//   STATUS_LOG=false             // true to include debug evidence in response
//   SKIP_AUTH=false              // set true only while testing (Telegram auth off)

import { q } from "./_db.js";
import { verifyTelegramInitData } from "./_tg.js";
import { llm } from "./_llm.js";

const LABELS = [
  "Talking stage",
  "Awaiting SoW",
  "SoW signed",
  "Awaiting payment",
  "Paid",
  "Preparing campaign",
  "Campaign live",
  "Awaiting report",
  "Campaign finished",
];

const DAYS_WINDOW = Number(process.env.STATUS_WINDOW_DAYS || 60);
const INCLUDE_DEBUG = String(process.env.STATUS_LOG || "false").toLowerCase() === "true";
const SKIP_AUTH = String(process.env.SKIP_AUTH || "false").toLowerCase() === "true";

// -------------------- Pattern Sets (EN + RU) --------------------

const RX = {
  // SoW signed
  sowSigned: [
    /\b(sow|scope of work|contract|agreement)\b.*\b(counter-)?signed|executed|fully\s+signed/iu,
    /\bподписан(о|а)?\b.*\b(dogovor|контракт|соглашение|тз|sow)\b/iu, // "подписан договор/контракт/..." (rough)
    /\bсоглашение\b.*\bподписан/iu,
  ],

  // Awaiting SoW (request to sign)
  awaitingSoW: [
    /(please|kindly)?\s*(sign|countersign|execute)\s*(the\s*)?(sow|contract|agreement)/iu,
    /\bawaiting\b.*\b(sow|contract|agreement)\b/iu,
    /\bнужно\b.*\bподписать\b.*\b(sow|договор|контракт|соглашение)\b/iu,
    /\bжд(ём|ем)\b.*\bподписан(ия|ие)\b.*\b(sow|договора|контракта|соглашения)\b/iu,
  ],

  // Payment contexts that should NOT count
  paidFalseContext: [
    /\bpaid\s+(plan|tier|version|subscription|feature|media|promotion|ads?|traffic|users?)\b/iu,
    /\bплатн(ая|ые|ый)\s+(версия|подписка|реклама|продвижение|медиа|тариф)\b/iu,
  ],

  // Awaiting payment (invoice sent / request to pay)
  awaitingPayment: [
    /\b(invoice|payment|wire|bank transfer|remittance|tx|transaction)\b.*\b(sent|issued|shared|awaiting|pending|due|pay|settle|payment details)\b/iu,
    /\bplease\s+(pay|wire|transfer|settle|remit)\b/iu,
    /\bсчет\b.*\b(выслан|отправил|отправили|выслали|выставлен|выставили)\b/iu,
    /\bжд(ём|ем)\b.*\b(оплаты|платежа)\b/iu,
    /\bпросим\b.*\b(оплатить|перевести)\b/iu,
    /\bреквизиты\b.*\b(оплаты|для оплаты|для перевода)\b/iu,
  ],

  // Payment confirmed (very strict)
  paidStrong: [
    /\b(payment|wi
