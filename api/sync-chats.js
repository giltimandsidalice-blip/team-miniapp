import { getChatsFromBot } from '../_utils/getChatsFromBot'; // you'll need to implement this
import { saveChatsToStorage } from '../_utils/storage';       // save to Redis, JSON, DB, etc.

export const config = { runtime: 'edge' };

export default async function handler(req) {
  try {
    const chats = await getChatsFromBot(); // Call Telegram API to fetch chats
    await saveChatsToStorage(chats);       // Save them somewhere
    return new Response(JSON.stringify({ ok: true, count: chats.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
