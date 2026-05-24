import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'

export async function POST(req: NextRequest) {
  const { msg, phone, callmebotKey, email, ntfyTopic } = await req.json() as {
    msg: string; phone?: string; callmebotKey?: string; email?: string; ntfyTopic?: string
  }

  const results: string[] = []
  const errors:  string[] = []

  // ── ntfy.sh push notification (no API key needed) ──────────────────────
  if (ntfyTopic) {
    try {
      // Strip non-ASCII chars (emojis) from header — HTTP headers must be ASCII
      const stripNonAscii = (s: string) => s.replace(/[^\x00-\x7F]/g, '').trim()
      const title = stripNonAscii(msg.split('\n')[0])
      const body  = msg.split('\n').slice(1).join('\n')
      const r = await fetch(`https://ntfy.sh/${ntfyTopic.trim()}`, {
        method: 'POST',
        headers: {
          'Title':    title || 'APEX Signal',
          'Priority': 'urgent',
          'Tags':     'rotating_light,bitcoin',
          'Content-Type': 'text/plain; charset=utf-8',
        },
        body: msg,
      })
      if (r.ok) results.push('ntfy')
      else errors.push(`ntfy:${r.status}`)
    } catch (e) {
      errors.push(`ntfy:${String(e)}`)
    }
  }

  // ── WhatsApp via CallMeBot ──────────────────────────────────────────────
  if (phone && callmebotKey) {
    try {
      const clean = phone.replace(/\D/g, '')
      const url   = `https://api.callmebot.com/whatsapp.php?phone=${clean}&text=${encodeURIComponent(msg)}&apikey=${callmebotKey}`
      const r = await fetch(url)
      if (r.ok) results.push('whatsapp')
      else errors.push(`whatsapp:${r.status}`)
    } catch (e) {
      errors.push(`whatsapp:${String(e)}`)
    }
  }

  // ── Email via SMTP (nodemailer) ─────────────────────────────────────────
  if (email) {
    const user = process.env.SMTP_USER
    const pass = process.env.SMTP_PASS
    const host = process.env.SMTP_HOST ?? 'smtp.gmail.com'
    const port = parseInt(process.env.SMTP_PORT ?? '587')
    if (user && pass) {
      try {
        const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } })
        await transporter.sendMail({
          from: `"APEX Trader BTC" <${user}>`,
          to: email,
          subject: msg.split('\n')[0],
          text: msg,
        })
        results.push('email')
      } catch (e) {
        errors.push(`email:${String(e)}`)
      }
    } else {
      errors.push('email:SMTP_USER/SMTP_PASS not configured in .env.local')
    }
  }

  return NextResponse.json({ ok: results.length > 0, sent: results, errors })
}
