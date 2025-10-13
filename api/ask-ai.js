// /api/ask-ai.js
import { chatComplete } from './_llm';
import { supabase } from './_db'; // ✅ reusing working client
import { withAuth } from './_auth'; // assuming you use this

export default withAuth(async (req, res, user) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { chat_id, prompt } = req.body || {};
  if (!chat_id || !prompt) {
    return res.status(400).json({ error: 'Missing chat_id or prompt' });
  }

  // Load recent messages from Supabase
  const { data, error } = await supabase
    .from('messages')
    .select('text')
    .eq('chat_id', chat_id)
    .order('created_at', { ascending: false })
    .limit(80);

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch messages', details: error.message });
  }

  const chatHistory = (data || [])
    .map(msg => msg.text)
    .filter(Boolean)
    .reverse()
    .join('\n');

  const systemPrompt = `You are an AI assistant helping a team understand a Telegram chat. Based on the chat messages, answer the user's question. Be concise and helpful.`;

  try {
    const aiResponse = await chatComplete({
      system: systemPrompt + '\n\nChat:\n' + chatHistory,
      user: prompt,
    });

    res.status(200).json({ text: aiResponse });
  } catch (err) {
    console.error('LLM error:', err);
    res.status(err.status || 500).json({ error: err.message || 'AI request failed' });
  }
});
