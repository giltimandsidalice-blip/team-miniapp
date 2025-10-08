const HAS_SB = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE);

export async function logJob({ sender_user_id, text, total, results }) {
  if (!HAS_SB) return null;
  try {
    const payload = {
      sender_user_id,
      total,
      ok_count: results.filter(r => r.status === "ok").length,
      fail_count: results.filter(r => r.status === "failed").length,
      sample: JSON.stringify({ text, results: results.slice(0, 20) })
    };
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/trbe_message_jobs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "apikey": process.env.SUPABASE_SERVICE_ROLE,
        "authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
        "prefer": "return=minimal"
      },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.warn("[Supabase] logJob failed:", e?.message || e);
  }
}
