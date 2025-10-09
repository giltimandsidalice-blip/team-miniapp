// api/reminders.js
import { sendToTelegram } from './_utils/sendToTelegram.js';
import { createClient } from '@supabase/supabase-js';

const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.DATABASE_URL; // assume it's a Postgres URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE;

const tg = { sendToTelegram };

const TARGET_DAYS = [1, 3, 5];

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  SUPABASE_KEY,
  { db: { schema: 'public' } }
);

function daysSince(dateStr) {
  if (!dateStr) return null;
  const then = new Date(dateStr);
  if (isNaN(then)) return null;
  const d = Math.floor((Date.now() - then.getTime()) / (1000 * 60 * 60 * 24));
  return d >= 0 ? d : null;
}

export const config = {
  schedule: '0 9 * * *' // every day at 9:00 UTC
};

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }

    if (!BOT_TOKEN || !SUPABASE_KEY || !SUPABASE_URL) {
      console.error('Missing required environment variables');
      return res.status(500).json({ error: 'SERVER_ERROR' });
    }

    const { data: chats, error } = await supabase
      .from('chats')
      .select('id, title, status, status_updated_at')
      .eq('status', 'SoW signed');

    if (error) throw error;

    const toSend = [];

    for (const chat of chats || []) {
      const days = daysSince(chat.status_updated_at);
      if (!TARGET_DAYS.includes(days)) continue;

      // check if this reminder was already sent
      const { data: existing } = await supabase
        .from('reminders_sent')
        .select('chat_id')
        .eq('chat_id', chat.id)
        .eq('days_since', days)
        .maybeSingle();

      if (existing) {
        console.log(`🔁 Reminder already sent for chat ${chat.id}, day ${days}`);
        continue;
      }

      // queue to send
      const message = `It’s been ${days} day${days !== 1 ? 's' : ''} since we signed the Statement of Work with **${chat.title || 'this team'}**.`;

      toSend.push({ chat_id: chat.id, message, days });
    }

    const results = [];

    for (const item of toSend) {
      const sendResult = await tg.sendToTelegram({
        botToken: BOT_TOKEN,
        method: 'sendMessage',
        payload: {
          chat_id: item.chat_id,
          text: item.message,
          parse_mode: 'Markdown',
          disable_notification: false,
        }
      });

      results.push({
        chat_id: item.chat_id,
        sent: sendResult?.ok,
        error: sendResult?.description || null,
      });

      if (sendResult?.ok) {
        await supabase
          .from('reminders_sent')
          .insert({ chat_id: item.chat_id, days_since: item.days });
      }
    }

    return res.status(200).json({ ok: true, sent: results.length, results });
  } catch (err) {
    console.error('💥 REMINDER ERROR', err);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
}
