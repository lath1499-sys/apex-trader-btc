import { NextRequest, NextResponse } from 'next/server'
import { setWebhook } from '@/lib/telegram'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const appUrl     = process.env.NEXT_PUBLIC_APP_URL ?? 'https://apex-trader-btc.vercel.app'
  const webhookUrl = `${appUrl}/api/telegram`
  const result     = await setWebhook(webhookUrl)

  return NextResponse.json({ webhookUrl, telegramResponse: result })
}
