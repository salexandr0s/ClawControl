'use client'

import { useCallback, useEffect, useState } from 'react'

type GatewayHealth = 'ok' | 'degraded' | 'unavailable'

interface GatewayStatusPayload {
  status: GatewayHealth
  latencyMs: number
  timestamp: string
  error?: string | null
  data: {
    running?: boolean
  } | null
}

interface UseGatewayStatusOptions {
  polling?: boolean
  refreshIntervalMs?: number
  initialStatus?: GatewayHealth
  initialLatencyMs?: number | null
  initialError?: string | null
}

async function fetchGatewayStatus(): Promise<GatewayStatusPayload | null> {
  const res = await fetch('/api/openclaw/gateway/status', { cache: 'no-store' })
  if (!res.ok) return null
  return res.json()
}

export function useGatewayStatus(options: UseGatewayStatusOptions = {}) {
  const polling = options.polling ?? true
  const refreshIntervalMs = options.refreshIntervalMs ?? 10_000
  const [status, setStatus] = useState<GatewayStatusPayload | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const current = await fetchGatewayStatus()
    if (current) {
      setStatus(current)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!polling) return

    const interval = window.setInterval(() => {
      void refresh()
    }, refreshIntervalMs)

    return () => window.clearInterval(interval)
  }, [polling, refresh, refreshIntervalMs])

  const normalizedStatus = status?.status ?? options.initialStatus ?? 'unavailable'
  const isOnline =
    normalizedStatus !== 'unavailable' &&
    (status?.data?.running ?? true)

  return {
    status: normalizedStatus,
    isOnline,
    latencyMs: status?.latencyMs ?? options.initialLatencyMs ?? null,
    lastCheck: status?.timestamp ?? null,
    error: status?.error ?? options.initialError ?? null,
    loading,
    refresh,
  }
}
