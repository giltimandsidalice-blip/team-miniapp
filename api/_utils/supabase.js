// api/_utils/supabase.js
import { createClient } from "@supabase/supabase-js";

/**
 * Build a Supabase client only if both URL and a service key exist.
 * Your project uses DATABASE_URL for the Supabase URL — we support that.
 * If either is missing, we return null and callers should skip logging.
 */
function resolveSupabaseUrl() {
  const candidates = [
    { env: "SUPABASE_URL", value: process.env.SUPABASE_URL },
    { env: "DATABASE_URL", value: process.env.DATABASE_URL },
    { env: "SUPABASE_PROJECT_URL", value: process.env.SUPABASE_PROJECT_URL },
    { env: "SUPABASE_PUBLIC_URL", value: process.env.SUPABASE_PUBLIC_URL },
  ];

  for (const { env, value } of candidates) {
    if (!value) continue;
    const trimmed = value.trim();
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }
    console.warn(
      `[supabase] Ignoring ${env} because it is not an http(s) URL.`
    );
  }

  return "";
}

export function getSupabase() {
  const url = resolveSupabaseUrl();

  const key =
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_SECRET ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLIC_ANON_KEY ||
    "";

  if (!url || !key) {
    if (!url) {
      console.error("[supabase] Missing Supabase URL configuration.");
    }
    if (!key) {
      console.error("[supabase] Missing Supabase key configuration.");
    }
    return null;
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-trbe-source": "miniapp-send-message" } },
  });
}

/**
 * Optional audit log. Never throws.
 */
export async function logJob({ sender_user_id, text, total, results }) {
  try {
    const sb = getSupabase();
    if (!sb) return { skipped: true, reason: "no-supabase-env" };

    const ok_count = (results || []).filter(r => r.status === "ok").length;
    const fail_count = (results || []).length - ok_count;

    const { error } = await sb.from("trbe_message_jobs").insert({
      sender_user_id: sender_user_id ?? null,
      total,
      ok_count,
      fail_count,
      sample: (results || []).slice(0, 10),
    });

    if (error) {
      console.warn("logJob insert error:", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    console.warn("logJob failed:", e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}
