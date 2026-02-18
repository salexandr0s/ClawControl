/**
 * Cron Repository
 *
 * Availability-aware repository for OpenClaw cron operations.
 * Returns OpenClawResponse<T> with explicit ok|degraded|unavailable status.
 */

import { runCommandJson, runDynamicCommandJson } from '@clawcontrol/adapters-openclaw'
import {
  type OpenClawResponse,
  type AvailabilityStatus,
  OPENCLAW_TIMEOUT_MS,
  DEGRADED_THRESHOLD_MS,
  CACHE_TTL_MS,
} from '@/lib/openclaw/availability'
import {
  normalizeCronJobsPayload,
  normalizeCronRunsPayload,
  normalizeCronStatusPayload,
  type CronJobDTO,
  type CronRunDTO,
  type CronStatusDTO,
} from './cron-normalize'

export type {
  CronStatusDTO,
  CronSchedule,
  CronPayload,
  CronJobDTO,
  CronRunDTO,
} from './cron-normalize'

// ============================================================================
// TYPES
// ============================================================================

// ============================================================================
// REPOSITORY INTERFACE
// ============================================================================

export interface CronRepo {
  status(): Promise<OpenClawResponse<CronStatusDTO>>
  list(): Promise<OpenClawResponse<CronJobDTO[]>>
  runs(jobId: string): Promise<OpenClawResponse<CronRunDTO[]>>
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

export function createCliCronRepo(): CronRepo {
  return {
    async status(): Promise<OpenClawResponse<CronStatusDTO>> {
      const cacheKey = 'cron.status'
      const cached = getCached<CronStatusDTO>(cacheKey)
      if (cached) return cached

      const start = Date.now()

      try {
        const res = await runCommandJson<unknown>('cron.status.json', {
          timeout: OPENCLAW_TIMEOUT_MS,
        })

        const latencyMs = Date.now() - start

        if (res.error || !res.data) {
          return {
            status: 'unavailable',
            latencyMs,
            data: null,
            error: res.error ?? 'Failed to get cron status',
            timestamp: new Date().toISOString(),
            cached: false,
          }
        }

        const statusData = normalizeCronStatusPayload(res.data)
        const status: AvailabilityStatus = latencyMs > DEGRADED_THRESHOLD_MS ? 'degraded' : 'ok'
        const response: OpenClawResponse<CronStatusDTO> = {
          status,
          latencyMs,
          data: statusData,
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

    async list(): Promise<OpenClawResponse<CronJobDTO[]>> {
      const cacheKey = 'cron.jobs'
      const cached = getCached<CronJobDTO[]>(cacheKey)
      if (cached) return cached

      const start = Date.now()

      try {
        const res = await runCommandJson<unknown>('cron.jobs.json', {
          timeout: OPENCLAW_TIMEOUT_MS,
        })

        const latencyMs = Date.now() - start

        if (res.error) {
          return {
            status: 'unavailable',
            latencyMs,
            data: null,
            error: res.error,
            timestamp: new Date().toISOString(),
            cached: false,
          }
        }

        const jobs = normalizeCronJobsPayload(res.data)

        const status: AvailabilityStatus = latencyMs > DEGRADED_THRESHOLD_MS ? 'degraded' : 'ok'
        const response: OpenClawResponse<CronJobDTO[]> = {
          status,
          latencyMs,
          data: jobs,
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

    async runs(jobId: string): Promise<OpenClawResponse<CronRunDTO[]>> {
      // Validate jobId format
      if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) {
        return {
          status: 'unavailable',
          latencyMs: 0,
          data: null,
          error: 'Invalid job ID format',
          timestamp: new Date().toISOString(),
          cached: false,
        }
      }

      const cacheKey = `cron.runs.${jobId}`
      const cached = getCached<CronRunDTO[]>(cacheKey)
      if (cached) return cached

      const start = Date.now()

      try {
        const res = await runDynamicCommandJson<unknown>('cron.runs', { id: jobId }, {
          timeout: OPENCLAW_TIMEOUT_MS,
        })

        const latencyMs = Date.now() - start

        if (res.error) {
          return {
            status: 'unavailable',
            latencyMs,
            data: null,
            error: res.error,
            timestamp: new Date().toISOString(),
            cached: false,
          }
        }

        const runs = normalizeCronRunsPayload(res.data, jobId)

        const status: AvailabilityStatus = latencyMs > DEGRADED_THRESHOLD_MS ? 'degraded' : 'ok'
        const response: OpenClawResponse<CronRunDTO[]> = {
          status,
          latencyMs,
          data: runs,
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
  }
}

// (No mock implementation: ClawControl must never return demo cron jobs.)
