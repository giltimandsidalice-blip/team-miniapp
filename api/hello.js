// File: api/hello.js  (Node.js Serverless Function on Vercel)
module.exports = (req, res) => {
  // Your Mini App sends Telegram's initData in this header.
  const initData = req.headers['x-telegram-init-data'] || '';
  res.setHeader('Content-Type', 'text/plain');
  res.status(200).send(`Hello from your backend ✅
We received initData length: ${String(initData).length}`);
};
