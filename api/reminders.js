module.exports = async (req, res) => {
  try {
    console.log("✅ reminders.js function started");

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    return res.status(200).json({ ok: true, message: "Reminders route is working" });
  } catch (err) {
    console.error("💥 Error inside reminders.js:", err);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
};

