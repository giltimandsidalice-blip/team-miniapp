import crypto from 'crypto'

export function verifyTelegramInitData(initDataRaw, botToken) {
  const params = new URLSearchParams(initDataRaw)
  const receivedHash = params.get('hash')
  params.delete('hash')

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n')

  const secret = crypto
    .createHash('sha256')
    .update(botToken)
    .digest()

  const expectedHash = crypto
    .createHmac('sha256', secret)
    .update(dataCheckString)
    .digest('hex')

  // Always use timing-safe compare
  const match = crypto.timingSafeEqual(
    Buffer.from(expectedHash, 'hex'),
    Buffer.from(receivedHash, 'hex')
  )

  return match
}
