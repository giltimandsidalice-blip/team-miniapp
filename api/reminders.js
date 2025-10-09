// api/reminders.js

const { createClient } = require('@supabase/supabase-js');
const { formatDistanceToNowStrict } = require('date-fns');

// Load environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
const TELEGRAM_BOT_TOKEN = process.env.BOT_TOKEN;

const fetch = require('node-fetch'); // required on Vercel

// Supabase client (admin)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    console.log("🔔 Reminder cron job triggered");

    // Fetch chats with status 'SoW signed'
    const { data: chats, error } = await supabase
      .from('chats')
      .select('id, title, username, status_updated_at')
      .eq('status', 'SoW signed');

    if (error) {
      console.error("❌ Supabase error:", error);
      return res.status(500).json({ error: 'Supabase error' });
    }

    const now = new Date();
    const remindersToSend = [];

    for (const chat of chats) {
      if (!chat.status_updated_at) continue;

      const updatedAt = new Date(chat.status_updated_at);
      const diffInDays = Math.floor((now - updatedAt) / (1000 * 60 * 60 * 24));

      if ([1, 3, 5].includes(diffInDays)) {
        const chatName = chat.title || chat.username || `chat ${chat.id}`;
        const message = `🕐 It’s been ${diffInDays} day${diffInDays > 1 ? 's' : ''} since we signed the Statement of Work with ${chatName}.`;
        remindersToSend.push({ chat_id: chat.id, text: message });
      }
    }

    // Send reminders to Telegram
    const results = await Promise.all(remindersToSend.map(({ chat_id, text }) => {
      return fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id,
          text,
          parse_mode: 'HTML'
        })
      }).then(res => res.json());
    }));

    console.log("✅ Reminders sent:", results.length);

    return res.status(200).json({ ok: true, sent: results.length });
  } catch (err) {
    console.error("💥 Reminder job failed:", err);
    return res.status(500).json({ error: 'Server error' });
  }
};
