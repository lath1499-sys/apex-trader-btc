import useSWR from 'swr'
import { useEffect } from 'react'
import { useApexStore } from '@/store/apexStore'
import type { OnChainData } from '@/lib/types'

async function fetcher(url: string): Promise<OnChainData> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<OnChainData>
}

export function useOnChain() {
  const setOnchain = useApexStore(s => s.setOnchain)
  const setConn    = useApexStore(s => s.setConn)

  const { data, error, isLoading } = useSWR<OnChainData>(
    '/api/onchain',
    fetcher,
    { refreshInterval: 90_000, revalidateOnFocus: false, dedupingInterval: 30_000 }
  )

  useEffect(() => {
    if (!data) return
    setOnchain(data)
    setConn({ onchain: !!data.hr })
  }, [data, setOnchain, setConn])

  return { isLoading, error: error as Error | undefined }
}
