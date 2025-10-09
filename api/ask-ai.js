const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY });

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { chat_id, prompt } = req.body;
    if (!chat_id || !prompt) return res.status(400).json({ error: 'Missing chat_id or prompt' });

    // Fetch all messages from the selected chat
    const { data: messages, error } = await supabase
      .from('messages')  // or your actual messages table name
      .select('text')
      .eq('chat_id', chat_id)
      .order('date', { ascending: true })  // optional: sort chronologically
      .limit(500);  // limit to 500 messages to avoid hitting token limit

    if (error) throw error;

    const chatContent = messages.map(m => m.text).join('\n');

    const finalPrompt = `Here are all messages from a Telegram chat:\n\n${chatContent}\n\nNow answer this:\n${prompt}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4',  // or gpt-3.5-turbo
      messages: [{ role: 'user', content: finalPrompt }],
      temperature: 0.7
    });

    const text = response.choices[0]?.message?.content?.trim() || '(no response)';
    return res.status(200).json({ text });

  } catch (err) {
    console.error('[ask-ai] error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
};
