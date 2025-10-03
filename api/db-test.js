// api/db-test.js
const { Pool } = require('pg');

function makeConfigFromUrl(raw) {
  const u = new URL(raw);
  return {
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    host: u.hostname,
    port: Number(u.port || 5432),
    database: u.pathname.replace(/^\//,''),
    ssl: { rejectUnauthorized: false },
  };
}

async function tryConnect(name, cfg) {
  const pool = new Pool(cfg);
  try {
    await pool.query('select 1');
    await pool.end();
    return { name, ok: true, user: cfg.user, host: cfg.host };
  } catch (e) {
    await pool.end().catch(()=>{});
    return { name, ok: false, user: cfg.user, host: cfg.host, error: e.message };
  }
}

module.exports = async (_req, res) => {
  try {
    const raw = process.env.DATABASE_URL;
    if (!raw) return res.status(500).json({ error: 'DATABASE_URL missing' });

    // Variant A: exactly your DATABASE_URL (username = postgres.<ref>)
    const A = makeConfigFromUrl(raw);

    // Variant B: same host/pass/db, but username = "postgres" AND add options=project=<ref>
    // IMPORTANT: replace the project ref below with yours (bbvvaqokstsccholednn).
    const PROJECT_REF = 'bbvvaqokstsccholednn';

    const urlB = new URL(raw);
    urlB.username = 'postgres';
    const hadQuery = !!urlB.search;
    const sep = hadQuery ? '&' : '?';
    urlB.search = (urlB.search || '') + `${sep}options=project%3D${PROJECT_REF}`;
    const B = makeConfigFromUrl(urlB.toString());

    const results = [];
    results.push(await tryConnect('VariantA_username=postgres.<ref>', A));
    results.push(await tryConnect('VariantB_username=postgres_with_options', B));

    res.status(200).json({ tried: results, note: 'use the variant that ok:true' });
  } catch (e) {
    res.status(500).send(`SERVER ERROR: ${e?.message || e}`);
  }
};
