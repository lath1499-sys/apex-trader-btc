import useSWR from 'swr'
import { useEffect } from 'react'
import { useApexStore } from '@/store/apexStore'
import type { NewsItem } from '@/lib/types'

interface NewsResponse {
  items: NewsItem[]
  successCount: number
  total: number
  error?: string
}

async function fetcher(url: string): Promise<NewsResponse> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<NewsResponse>
}

export function useNews() {
  const setNews = useApexStore(s => s.setNews)
  const setConn = useApexStore(s => s.setConn)

  const { data, error, isLoading } = useSWR<NewsResponse>(
    '/api/news',
    fetcher,
    { refreshInterval: 180_000, revalidateOnFocus: false, dedupingInterval: 60_000 }
  )

  useEffect(() => {
    if (!data || data.error) return
    setNews(data.items ?? [])
    setConn({ news: data.total > 0, newsCount: data.successCount })
  }, [data, setNews, setConn])

  return { isLoading, error: error as Error | undefined }
}
