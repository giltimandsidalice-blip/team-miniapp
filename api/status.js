// api/status.js (ESM, idempotent table creation + upsert)
import { q } from "./_db.js";
import { verifyTelegramInitData } from "./_tg.js";

const SKIP_AUTH = false;

async function ensureTable() {
  await q(`
    create table if not exists chat_status (
      chat_id    bigint primary key,
      status     text not null,
      updated_at timestamptz not null default now()
    );
  `);
}

exp
