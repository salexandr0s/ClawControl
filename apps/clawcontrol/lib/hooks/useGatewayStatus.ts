'use client'

import { useCallback, useEffect, useState } from 'react'

export type GatewayHealth = 'ok' | 'degraded' | 'unavailable'

export interface GatewayStatusPayload {
  status: GatewayHealth
  latencyMs: number
  timestamp: string
  error?: string | null
  data: {
    running?: boolean
  } | null
}

export interface UseGatewayStatusOptions {
  polling?: boolean
  refreshIntervalMs?: number
  initialStatus?: GatewayHealth
  initialLatencyMs?: number | null
  initialError?: string | null
}

export interface DerivedGatewayStatus {
  status: GatewayHealth
  isOnline: boolean
  runtimeRunning: boolean | null
  latencyMs: number | null
  lastCheck: string | null
  error: string | null
}

async function fetchGatewayStatus(): Promise<GatewayStatusPayload | null> {
  try {
    const res = await fetch('/api/openclaw/gateway/status', { cache: 'no-store' })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export function deriveGatewayStatusState(
  status: GatewayStatusPayload | null,
  options: Pick<UseGatewayStatusOptions, 'initialStatus' | 'initialLatencyMs' | 'initialError'> = {}
): DerivedGatewayStatus {
  const normalizedStatus = status?.status ?? options.initialStatus ?? 'unavailable'
  const runtimeRunning =
    typeof status?.data?.running === 'boolean'
      ? status.data.running
      : null
  const isOnline = normalizedStatus !== 'unavailable'

  return {
    status: normalizedStatus,
    isOnline,
    runtimeRunning,
    latencyMs: status?.latencyMs ?? options.initialLatencyMs ?? null,
    lastCheck: status?.timestamp ?? null,
    error: status?.error ?? options.initialError ?? null,
  }
}

export function useGatewayStatus(options: UseGatewayStatusOptions = {}) {
  const polling = options.polling ?? true
  const refreshIntervalMs = options.refreshIntervalMs ?? 10_000
  const [status, setStatus] = useState<GatewayStatusPayload | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const current = await fetchGatewayStatus()
      if (current) {
        setStatus(current)
      } else {
        setStatus({
          status: 'unavailable',
          latencyMs: 0,
          timestamp: new Date().toISOString(),
          error: 'Failed to fetch gateway status',
          data: null,
        })
      }
    } finally {
      setLoading(false)
    }
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

  const derived = deriveGatewayStatusState(status, options)

  return {
    ...derived,
    loading,
    refresh,
  }
}
