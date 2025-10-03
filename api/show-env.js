// api/show-env.js
module.exports = async (_req, res) => {
  try {
    const raw = process.env.DATABASE_URL || '';
    if (!raw) return res.status(200).json({ hasDATABASE_URL: false });

    const u = new URL(raw);
    res.status(200).json({
      hasDATABASE_URL: true,
      parsed: {
        user: decodeURIComponent(u.username),
        host: u.hostname,
        port: u.port,
        db: u.pathname.replace(/^\//,'')
      },
      // masked raw for sanity
      rawMasked: raw.replace(/:(?:[^@]*)@/, ':***@')
    });
  } catch (e) {
    res.status(500).send(`SHOW-ENV ERROR: ${e?.message || e}`);
  }
};
