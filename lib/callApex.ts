interface ApexResponse { text?: string; error?: string }

export async function callApex(
  userMessage: string,
  context: string,
  imageBase64?: string,
): Promise<string> {
  const res = await fetch('/api/apex', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userMessage, context, imageBase64 }),
  })
  const data = await res.json() as ApexResponse
  if (!res.ok || data.error) {
    const raw = data.error ?? `HTTP ${res.status}`
    // Extract human-readable message from Anthropic error JSON strings like "400 {...}"
    let msg = raw
    try {
      const jsonStart = raw.indexOf('{')
      if (jsonStart !== -1) {
        const parsed = JSON.parse(raw.slice(jsonStart)) as { error?: { message?: string } }
        if (parsed?.error?.message) msg = parsed.error.message
      }
    } catch { /* keep raw */ }
    throw new Error(msg)
  }
  return data.text ?? ''
}

export function compressImage(b64: string): Promise<string> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const MAX = 700
      const ratio = Math.min(MAX / img.width, MAX / img.height, 1)
      const cv = document.createElement('canvas')
      cv.width  = Math.round(img.width  * ratio)
      cv.height = Math.round(img.height * ratio)
      cv.getContext('2d')?.drawImage(img, 0, 0, cv.width, cv.height)
      resolve(cv.toDataURL('image/jpeg', 0.55).split(',')[1])
    }
    img.onerror = () => resolve(b64)
    img.src = 'data:image/png;base64,' + b64
  })
}
