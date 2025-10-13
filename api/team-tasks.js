import { q } from './_db.js';
import { getSupabase } from './_utils/supabase.js';

function normalizeHandle(handle = '') {
  return String(handle || '').trim().replace(/^@/, '');
}

function toLowerHandle(handle = '') {
  return normalizeHandle(handle).toLowerCase();
}

async function handleGet(req, res) {
  const filterRaw = req.query?.username || req.query?.tg_username || req.query?.handle || '';
  const filter = toLowerHandle(filterRaw);
  const wantsPast = String(req.query?.past ?? '').toLowerCase() === 'true';
  
  if (!filter) {
      if (wantsPast) {
      return res.status(200).json({ pastTasks: [] });
    }
    return res.status(200).json({ active: [], tasks: [] });
  }

  if (wantsPast) {
    try {
      const result = await q(
        `SELECT id, tg_username, tg_user_id, description, completed_at, created_at
         FROM past_tasks
         WHERE tg_username = $1
           AND completed_at >= date_trunc('week', now())
           AND completed_at < date_trunc('week', now()) + interval '5 days'
         ORDER BY completed_at DESC`,
        [filter],
      );

      const rows = Array.isArray(result?.rows) ? result.rows : [];
      return res.status(200).json({ pastTasks: rows });
    } catch (err) {
      if (err?.code === '42P01') {
        console.warn('team-tasks GET missing past_tasks table:', err.message || err);
        return res.status(200).json({ pastTasks: [] });
      }
      console.error('team-tasks GET past tasks error:', err);
      return res.status(500).json({ error: 'Failed to load past tasks' });
    }
  }

  const sb = getSupabase();
  if (!sb) {
    console.error('team-tasks GET missing Supabase configuration');
    return res.status(500).json({ error: 'Failed to load tasks' });
  }

  try {
    const { data, error } = await sb
      .from('team_tasks')
      .select('id, tg_username, tg_user_id, description, created_at')
      .eq('tg_username', filter)
      .order('created_at', { ascending: false });

    if (error) {
      const message = error?.message || '';
      if (error?.code === '42P01' || /team_tasks/i.test(message)) {
        console.warn('team-tasks GET missing table:', message);
        return res.status(200).json({ active: [], tasks: [] });
      }
      console.error('team-tasks GET Supabase error:', message);
      return res.status(500).json({ error: 'Failed to load tasks' });
    }

    const rows = Array.isArray(data) ? data : [];
    return res.status(200).json({ active: rows, tasks: rows });
  } catch (err) {
    console.error('team-tasks GET error:', err);
    return res.status(500).json({ error: 'Failed to load tasks' });
  }
}

async function handlePost(req, res) {
  const { tg_username, tg_user_id, description } = req.body || {};
  const username = normalizeHandle(tg_username);
  const text = typeof description === 'string' ? description.trim() : '';

  if (!username || !text) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const rawUserId = tg_user_id;
  let userId = null;
  const hasUserId = rawUserId !== undefined && rawUserId !== null && String(rawUserId).trim() !== '';

  if (hasUserId) {
    const userIdNumber = Number(rawUserId);
    if (!Number.isSafeInteger(userIdNumber) || userIdNumber < 0) {
      return res.status(400).json({ error: 'Task not saved: Invalid user ID' });
    }
    if (userIdNumber > 0) {
      userId = userIdNumber;
    }
  }

  const sb = getSupabase();
  if (!sb) {
    console.error('team-tasks POST missing Supabase configuration');
    return res.status(500).json({ error: 'Failed to save task' });
  }

  try {
    const { data, error } = await sb
      .from('team_tasks')
      .insert([
        {
          tg_username: username,
          tg_user_id: userId,
          description: text,
        },
      ])
      .select('id, tg_username, tg_user_id, description, created_at')
      .single();

    if (error) {
      const message = error?.message || '';
      if (/foreign key/i.test(message) || /user id/i.test(message)) {
        return res.status(400).json({ error: 'Task not saved: Invalid user ID' });
      }
      console.error('team-tasks POST insert error:', message);
      return res.status(500).json({ error: 'Failed to save task' });
    }

    return res.status(200).json({ task: data || null });
  } catch (err) {
    if (err?.code === '42P01') {
      console.error('team-tasks POST missing table:', err);
      return res.status(500).json({ error: 'Team tasks table not found' });
    }
    console.error('team-tasks POST error:', err);
    return res.status(500).json({ error: 'Failed to save task' });
  }
}

async function handleDelete(req, res) {
  const rawId = req.body?.id;
  const numericId = Number(rawId);
  if (!Number.isSafeInteger(numericId)) {
    return res.status(400).json({ error: 'Invalid task id' });
  }

  try {
    const { rowCount } = await q('DELETE FROM team_tasks WHERE id = $1', [numericId]);
    return res.status(200).json({ success: rowCount > 0 });
  } catch (err) {
    if (err?.code === '42P01') {
      console.warn('team-tasks DELETE missing table:', err.message);
      return res.status(200).json({ success: false });
    }
    console.error('team-tasks DELETE error:', err);
    return res.status(500).json({ error: 'Failed to remove task' });
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return handleGet(req, res);
  }
  if (req.method === 'POST') {
    return handlePost(req, res);
  }
  if (req.method === 'DELETE') {
    return handleDelete(req, res);
  }

  res.setHeader('Allow', 'GET,POST,DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
