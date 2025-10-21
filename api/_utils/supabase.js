// api/_utils/supabase.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = (() => {
  const raw = process.env.SUPABASE_URL;
  if (!raw || !String(raw).trim()) {
    throw new Error("[supabase] SUPABASE_URL is missing");
  }
  const trimmed = String(raw).trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("[supabase] SUPABASE_URL must be an http(s) URL");
  }
  return trimmed;
})();

const SUPABASE_SERVICE_ROLE = (() => {
  const raw = process.env.SUPABASE_SERVICE_ROLE;
  if (!raw || !String(raw).trim()) {
    throw new Error("[supabase] SUPABASE_SERVICE_ROLE is missing");
  }
  return String(raw).trim();
})();

let cachedClient = null;

export function getSupabase() {
  if (cachedClient) return cachedClient;

  cachedClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-trbe-source": "miniapp-send-message" } },
  });

  return cachedClient;
}

/**
 * Optional audit log. Never throws.
 */
export async function logJob({ sender_user_id, text, total, results }) {
  try {
    const sb = getSupabase();

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
