import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const client = new Anthropic()

const SYSTEM_PROMPT =
  'Eres APEX Trader BTC v8: trader profesional 15 años futuros Binance. ' +
  'TIPOS: Scalp(15M,<2h,R:R 1.5:1,max10x), DayTrade(1H,2-24h,R:R 2:1,max5x), Swing(4H/1D,días,R:R 3:1,max3x). ' +
  'REGLAS: min 3 confluencias, siempre SL, integra on-chain+ciclo+news. ' +
  'FORMATO: 📊 SETUP:[LONG/SHORT/ESPERAR] TIPO:[Scalp/DayTrade/Swing] | 🎯 SESGO | LECTURA 1D/4H/1H | NEWS IMPACT | ' +
  '🟢 ENTRADA $$ | 🔴 SL $$ | ✅ TP1 TP2 TP3 R:R | ⚡ LEVERAGE | ✔ CONFLUENCIAS | ⚠️ INVALIDACIÓN | 📊 CONFIANZA. Español.'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      userMessage: string
      context: string
      imageBase64?: string
    }

    const { userMessage, context, imageBase64 } = body

    if (!userMessage && !context) {
      return NextResponse.json({ error: 'userMessage or context required' }, { status: 400 })
    }

    const promptText = `DATOS MERCADO BINANCE EN VIVO:\n${context}\n\n${userMessage || 'Dame setup APEX completo con entrada, SL y TPs.'}`

    type ContentBlock =
      | { type: 'text'; text: string }
      | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg'; data: string } }

    const content: ContentBlock | ContentBlock[] = imageBase64
      ? [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
          { type: 'text', text: promptText },
        ]
      : { type: 'text', text: promptText }

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: content as Anthropic.MessageParam['content'] }],
    })

    const text = response.content.find(b => b.type === 'text')?.text ?? ''
    return NextResponse.json({ text })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
