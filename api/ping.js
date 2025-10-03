// api/ping.js
module.exports = async (_req, res) => {
  res.status(200).json({ ok: true, ts: new Date().toISOString() });
};
