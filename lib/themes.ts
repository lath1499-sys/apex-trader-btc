import type { Theme, ThemeName } from './types'

export const THEMES: Record<ThemeName, Theme> = {
  terminal: {
    bg: '#030703', card: '#070d07', border: '#0f1f0f', text: '#b0c8b0',
    textSec: '#5a8a5a', accent: '#00d084', danger: '#ff4757', warn: '#ffd700',
    price: '#f7931a', muted: '#1e4a1e', bull: '#00d084', bear: '#ff4757',
  },
  white: {
    bg: '#f0f2f5', card: '#ffffff', border: '#e2e8f0', text: '#1e293b',
    textSec: '#64748b', accent: '#16a34a', danger: '#ef4444', warn: '#f59e0b',
    price: '#ea580c', muted: '#94a3b8', bull: '#16a34a', bear: '#ef4444',
  },
  midnight: {
    bg: '#070714', card: '#0f0f28', border: '#1a1a42', text: '#c8d8ff',
    textSec: '#5a6a9a', accent: '#7b9fff', danger: '#ff6b9d', warn: '#fbbf24',
    price: '#f7931a', muted: '#2a3a6a', bull: '#7b9fff', bear: '#ff6b9d',
  },
  amber: {
    bg: '#0d0800', card: '#1a1200', border: '#2a2000', text: '#fde68a',
    textSec: '#a16207', accent: '#f7931a', danger: '#ef4444', warn: '#ffd700',
    price: '#ffd700', muted: '#78350f', bull: '#f7931a', bear: '#ef4444',
  },
  tradingview: {
    bg: '#131722', card: '#1e222d', border: '#2a2e39', text: '#d1d4dc',
    textSec: '#787b86', accent: '#2962ff', danger: '#f23645', warn: '#ff9800',
    price: '#f7931a', muted: '#363c4e', bull: '#26a69a', bear: '#ef5350',
  },
}

export const THEME_NAMES = Object.keys(THEMES) as ThemeName[]
