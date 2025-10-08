console.log("has initData header:", !!req.headers["x-telegram-init-data"]);
console.log("bot token suffix:", (process.env.BOT_TOKEN_AI || "").slice(-6));
