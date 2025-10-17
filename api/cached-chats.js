// api/cached-chats.js

import { q } from './_db.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { rows } = await q(
      `SELECT chat_id, title, username
       FROM public.cached_chats
       ORDER BY chat_id DESC
       LIMIT 2000`
    );

    return res.status(200).json(Array.isArray(rows) ? rows : []);
  } catch (err) {
    if (err?.code === '42P01') {
      console.warn('cached-chats GET missing table:', err?.message || err);
      return res.status(200).json([]);
    }

    console.error('cached-chats GET error:', err?.message || err);
    return res.status(500).json({ error: 'Failed to load cached chats' });
  }
}
