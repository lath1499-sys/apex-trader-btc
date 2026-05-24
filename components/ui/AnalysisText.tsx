'use client'
import { useTheme } from '@/hooks/useTheme'

interface Props { text: string }

export default function AnalysisText({ text }: Props) {
  const T = useTheme()
  if (!text) return (
    <div style={{ color: T.muted, fontSize: 12, textAlign: 'center', padding: 32 }}>
      Pulsa ⚡ ANALIZAR para recibir el setup completo
    </div>
  )
  return (
    <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.9, fontSize: 12 }}>
      {text.split('\n').map((ln, i) => {
        let color = T.text, fw = 400, mt = 0, fs = 12
        if (ln.includes('═'))                              { color = T.border; fs = 11 }
        else if (ln.startsWith('📊 SETUP:'))              { color = T.bull;   fw = 700; fs = 14; mt = 8 }
        else if (ln.startsWith('🎯'))                      { color = T.accent; mt = 4 }
        else if (ln.startsWith('🔴'))                      { color = T.danger }
        else if (ln.startsWith('✅'))                      { color = T.bull }
        else if (ln.startsWith('⚡') || ln.startsWith('💼')) { color = T.warn }
        else if (ln.startsWith('⚠️'))                     { color = T.warn;   fw = 700 }
        else if (ln.startsWith('✔'))                       { color = T.accent }
        else if (ln.startsWith('📊 CONFIANZA') || ln.startsWith('🚨')) { color = T.bull; fw = 700; mt = 4 }
        else if (ln.startsWith('🟢'))                      { color = T.bull;   fw = 700 }
        else if (ln.startsWith('📌') || ln.startsWith('•')) { color = T.textSec }
        return (
          <span key={i} style={{ display: 'block', color, fontWeight: fw, marginTop: mt, fontSize: fs }}>
            {ln}
          </span>
        )
      })}
    </div>
  )
}
