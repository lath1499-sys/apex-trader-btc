// APEX — Multi-TF Pattern Confluence
// A pattern appearing on 4H AND 1D simultaneously is 2-3x more reliable.
// Finds shared patterns across timeframes and calculates combined confidence.

import type { PatternDetection } from './candlePatterns'

export interface SharedPattern {
  name:               string
  type:               'bullish' | 'bearish' | 'neutral'
  tfs:                string[]
  combinedConfidence: number   // average confidence + multi-TF bonus
}

export interface PatternConfluence {
  sharedPatterns:  SharedPattern[]
  confluenceScore: number         // 0-100
  strongestSignal: 'bullish' | 'bearish' | 'neutral'
  description:     string
}

export function findPatternConfluence(
  patternsByTF: Record<string, PatternDetection[]>,
): PatternConfluence {
  // Collect all patterns and which TFs they appear in
  const patternMap = new Map<string, { tfs: string[]; confidences: number[]; type: string }>()

  for (const [tf, patterns] of Object.entries(patternsByTF)) {
    for (const p of patterns) {
      const key = p.pattern.name
      if (!patternMap.has(key)) {
        patternMap.set(key, { tfs: [], confidences: [], type: p.pattern.type })
      }
      const entry = patternMap.get(key)!
      if (!entry.tfs.includes(tf)) {
        entry.tfs.push(tf)
        entry.confidences.push(p.confidence)
      }
    }
  }

  // Find patterns that appear in 2+ timeframes
  const sharedPatterns: SharedPattern[] = []
  for (const [name, v] of patternMap.entries()) {
    if (v.tfs.length < 2) continue
    const avgConf = v.confidences.reduce((a, b) => a + b, 0) / v.confidences.length
    sharedPatterns.push({
      name,
      type:               v.type as 'bullish' | 'bearish' | 'neutral',
      tfs:                v.tfs,
      // Multi-TF bonus: +15% confidence per additional TF
      combinedConfidence: Math.min(99, avgConf + (v.tfs.length - 1) * 15),
    })
  }

  sharedPatterns.sort((a, b) => b.combinedConfidence - a.combinedConfidence)

  const bullCount  = sharedPatterns.filter(p => p.type === 'bullish').length
  const bearCount  = sharedPatterns.filter(p => p.type === 'bearish').length

  const strongestSignal: 'bullish' | 'bearish' | 'neutral' =
    bullCount > bearCount ? 'bullish'
    : bearCount > bullCount ? 'bearish'
    : 'neutral'

  const confluenceScore = Math.min(100,
    sharedPatterns.length * 20 + (bullCount !== bearCount ? 10 : 0),
  )

  const description = sharedPatterns.length > 0
    ? `${sharedPatterns[0].name} confirmado en ${sharedPatterns[0].tfs.join('+')} — confianza combinada ${sharedPatterns[0].combinedConfidence.toFixed(0)}%`
    : 'Sin confluencia de patrones entre timeframes'

  return { sharedPatterns, confluenceScore, strongestSignal, description }
}
