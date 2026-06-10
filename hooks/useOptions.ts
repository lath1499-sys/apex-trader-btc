// hooks/useOptions.ts — SWR hook for /api/options (Max Pain + IV Rank)
import useSWR from 'swr'
import type { OptionsData } from '@/lib/impliedVolatility'

const fetcher = (url: string) => fetch(url).then(r => r.json())

export function useOptions(): { data: OptionsData | null; loading: boolean } {
  const { data, isLoading } = useSWR<OptionsData>('/api/options', fetcher, {
    refreshInterval: 15 * 60 * 1000,   // 15 min — matches server cache TTL
    revalidateOnFocus: false,
  })
  return { data: data ?? null, loading: isLoading }
}
