import { NextRequest, NextResponse } from 'next/server'
import { sendTelegram } from '@/lib/telegram'
import { sendNtfy } from '@/lib/ntfy'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const ts         = new Date().toISOString()
  const ntfyTopic  = process.env.NTFY_TOPIC ?? ''
  const results: Record<string, string> = {}

  const [tgResult, ntfyResult] = await Promise.allSettled([
    sendTelegram(
      `🧪 <b>APEX Notification Test</b>\n` +
      `Telegram: ✅ funcionando\n` +
      `NTFY topic: ${ntfyTopic ? ntfyTopic : '⚠️ no configurado'}\n` +
      `<i>${ts}</i>`,
    ),
    ntfyTopic
      ? sendNtfy(
          ntfyTopic,
          'APEX Notification Test',
          `Telegram + NTFY funcionando correctamente.\n${ts}`,
          3,
          ['white_check_mark', 'bell'],
        )
      : Promise.resolve(false),
  ])

  results.telegram = tgResult.status === 'fulfilled' ? 'OK' : `ERROR: ${(tgResult as PromiseRejectedResult).reason}`
  results.ntfy     = !ntfyTopic
    ? 'NTFY_TOPIC not configured'
    : ntfyResult.status === 'fulfilled' && ntfyResult.value
      ? 'OK'
      : ntfyResult.status === 'fulfilled'
        ? 'SENT_BUT_FALSE'
        : `ERROR: ${(ntfyResult as PromiseRejectedResult).reason}`

  console.log('[NOTIFY-TEST]', results)
  return NextResponse.json({ ts, ntfyTopic: ntfyTopic || null, results })
}
