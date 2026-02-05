/**
 * Gateway Repository
 *
 * Availability-aware repository for OpenClaw gateway operations.
 * Returns OpenClawResponse<T> with explicit ok|degraded|unavailable status.
 */

import { runCommandJson } from '@clawcontrol/adapters-openclaw'
import {
  type OpenClawResponse,
  type AvailabilityStatus,
  OPENCLAW_TIMEOUT_MS,
  DEGRADED_THRESHOLD_MS,
  CACHE_TTL_MS,
} from '@/lib/openclaw/availability'

// ============================================================================
// TYPES
// ============================================================================

export interface GatewayStatusDTO {
  running: boolean
  pid?: number
  uptime?: number
  version?: string
  connections?: {
    active: number
    idle: number
  }
  memory?: {
    heapUsed: number
    heapTotal: number
    rss: number
  }
}

export interface GatewayHealthDTO {
  healthy: boolean
  checks?: {
    name: string
    status: 'pass' | 'fail' | 'warn'
    message?: string
  }[]
}

export interface GatewayProbeDTO {
  reachable: boolean
  latencyMs: number
  error?: string
}

// ============================================================================
// REPOSITORY INTERFACE
// ============================================================================

export interface GatewayRepo {
  status(): Promise<OpenClawResponse<GatewayStatusDTO>>
  health(): Promise<OpenClawResponse<GatewayHealthDTO>>
  probe(): Promise<OpenClawResponse<GatewayProbeDTO>>
}

// ============================================================================
// IN-MEMORY CACHE
// ============================================================================

interface CacheEntry<T> {
  data: OpenClawResponse<T>
  cachedAt: number
}

const cache = new Map<string, CacheEntry<unknown>>()

function getCached<T>(key: string): OpenClawResponse<T> | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined
  if (!entry) return null

  const age = Date.now() - entry.cachedAt
  if (age > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }

  return {
    ...entry.data,
    cached: true,
    staleAgeMs: age,
  }
}

function setCache<T>(key: string, response: OpenClawResponse<T>): void {
  cache.set(key, { data: response, cachedAt: Date.now() })
}

// ============================================================================
// CLI IMPLEMENTATION
// ============================================================================

export function createCliGatewayRepo(): GatewayRepo {
  return {
    async status(): Promise<OpenClawResponse<GatewayStatusDTO>> {
      const cacheKey = 'gateway.status'
      const cached = getCached<GatewayStatusDTO>(cacheKey)
      if (cached) return cached

      const start = Date.now()

      try {
        const res = await runCommandJson<GatewayStatusDTO>('status.json', {
          timeout: OPENCLAW_TIMEOUT_MS,
        })

        const latencyMs = Date.now() - start

        if (res.error || !res.data) {
          return {
            status: 'unavailable',
            latencyMs,
            data: null,
            error: res.error ?? 'Failed to get gateway status',
            timestamp: new Date().toISOString(),
            cached: false,
          }
        }

        const status: AvailabilityStatus = latencyMs > DEGRADED_THRESHOLD_MS ? 'degraded' : 'ok'
        const response: OpenClawResponse<GatewayStatusDTO> = {
          status,
          latencyMs,
          data: res.data,
          error: null,
          timestamp: new Date().toISOString(),
          cached: false,
        }

        setCache(cacheKey, response)
        return response
      } catch (err) {
        return {
          status: 'unavailable',
          latencyMs: Date.now() - start,
          data: null,
          error: err instanceof Error ? err.message : 'Unknown error',
          timestamp: new Date().toISOString(),
          cached: false,
        }
      }
    },

    async health(): Promise<OpenClawResponse<GatewayHealthDTO>> {
      const cacheKey = 'gateway.health'
      const cached = getCached<GatewayHealthDTO>(cacheKey)
      if (cached) return cached

      const start = Date.now()

      try {
        const res = await runCommandJson<GatewayHealthDTO>('health.json', {
          timeout: OPENCLAW_TIMEOUT_MS,
        })

        const latencyMs = Date.now() - start

        if (res.error || !res.data) {
          return {
            status: 'unavailable',
            latencyMs,
            data: null,
            error: res.error ?? 'Failed to get gateway health',
            timestamp: new Date().toISOString(),
            cached: false,
          }
        }

        const status: AvailabilityStatus = latencyMs > DEGRADED_THRESHOLD_MS ? 'degraded' : 'ok'
        const response: OpenClawResponse<GatewayHealthDTO> = {
          status,
          latencyMs,
          data: res.data,
          error: null,
          timestamp: new Date().toISOString(),
          cached: false,
        }

        setCache(cacheKey, response)
        return response
      } catch (err) {
        return {
          status: 'unavailable',
          latencyMs: Date.now() - start,
          data: null,
          error: err instanceof Error ? err.message : 'Unknown error',
          timestamp: new Date().toISOString(),
          cached: false,
        }
      }
    },

    async probe(): Promise<OpenClawResponse<GatewayProbeDTO>> {
      // Probe is not cached - it's meant to be a fresh check
      const start = Date.now()

      try {
        const res = await runCommandJson<GatewayProbeDTO>('probe', {
          timeout: OPENCLAW_TIMEOUT_MS,
        })

        const latencyMs = Date.now() - start

        if (res.error) {
          return {
            status: 'unavailable',
            latencyMs,
            data: { reachable: false, latencyMs, error: res.error },
            error: res.error,
            timestamp: new Date().toISOString(),
            cached: false,
          }
        }

        const probeData: GatewayProbeDTO = res.data ?? { reachable: true, latencyMs }
        const status: AvailabilityStatus = latencyMs > DEGRADED_THRESHOLD_MS ? 'degraded' : 'ok'

        return {
          status,
          latencyMs,
          data: probeData,
          error: null,
          timestamp: new Date().toISOString(),
          cached: false,
        }
      } catch (err) {
        const latencyMs = Date.now() - start
        return {
          status: 'unavailable',
          latencyMs,
          data: { reachable: false, latencyMs, error: err instanceof Error ? err.message : 'Unknown error' },
          error: err instanceof Error ? err.message : 'Unknown error',
          timestamp: new Date().toISOString(),
          cached: false,
        }
      }
    },
  }
}

// (No mock implementation: ClawControl must never return demo gateway data.)
