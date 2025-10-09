import { getMe } from './_utils/sendToTelegram.js'
import { sha256, verifyTelegramInitData } from './_utils/verifyTelegram.js'

export default async function handler(req, res) {
  const initDataRaw = req.headers['x-telegram-init-data'] || ''

  if (!initDataRaw) {
    return res.status(400).json({ error: 'NO_INIT_DATA' })
  }

  // Parse init data
  const params = new URLSearchParams(initDataRaw)
  const initData = {}
  for (const [key, value] of params.entries()) {
    if (key === 'hash') continue
    initData[key] = value
  }

  // Who does the server think it is?
  const botMe = await getMe(process.env.BOT_TOKEN)

  return res.status(200).json({
    initDataLength: initDataRaw.length,
    parsedKeys: Object.keys(initData),
    botMe,
    envInfo: {
      hasToken: !!process.env.BOT_TOKEN,
      tokenLast4: process.env.BOT_TOKEN?.slice(-4), // Safe peek
    }
  })
}
