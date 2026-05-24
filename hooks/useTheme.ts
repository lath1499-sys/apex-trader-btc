import { useApexStore } from '@/store/apexStore'
import { THEMES } from '@/lib/themes'
import type { Theme } from '@/lib/types'

export function useTheme(): Theme {
  const themeName = useApexStore(s => s.themeName)
  return THEMES[themeName] ?? THEMES.terminal
}
