import { NextResponse } from 'next/server'
import { runCommandJson } from '@clawcontrol/adapters-openclaw'
import {
  type OpenClawResponse,
  OPENCLAW_TIMEOUT_MS,
  DEGRADED_THRESHOLD_MS,
  getCached,
  setCache,
} from '@/lib/openclaw/availability'
import { classifyOpenClawError } from '@/lib/openclaw/error-shape'
import { normalizeCronStatusPayload, type CronStatusDTO } from '@/lib/repo/cron-normalize'

const CACHE_KEY = 'cron.status'

/**
 * GET /api/openclaw/cron/status
 *
 * Returns cron scheduler status with explicit availability semantics.
 * Always returns 200 with structured OpenClawResponse (not 500).
 */
export async function GET(): Promise<NextResponse<OpenClawResponse<CronStatusDTO>>> {
  // Check cache first (15s TTL to prevent refresh cascade)
  const cached = getCached<CronStatusDTO>(CACHE_KEY)
  if (cached) {
    return NextResponse.json(cached)
  }

  const start = Date.now()

  try {
    const res = await runCommandJson<unknown>('cron.status.json', {
      timeout: OPENCLAW_TIMEOUT_MS,
    })

    const latencyMs = Date.now() - start

    if (res.error) {
      const details = classifyOpenClawError(res.error ?? 'Failed to get cron status', {
        parseFailed: false,
      })
      const response: OpenClawResponse<CronStatusDTO> = {
        status: 'unavailable',
        latencyMs,
        data: null,
        error: res.error ?? 'Failed to get cron status',
        ...details,
        timestamp: new Date().toISOString(),
        cached: false,
      }
      return NextResponse.json(response)
    }

    const response: OpenClawResponse<CronStatusDTO> = {
      status: latencyMs > DEGRADED_THRESHOLD_MS ? 'degraded' : 'ok',
      latencyMs,
      data: normalizeCronStatusPayload(res.data),
      error: null,
      timestamp: new Date().toISOString(),
      cached: false,
    }

    setCache(CACHE_KEY, response)
    return NextResponse.json(response)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    const latencyMs = Date.now() - start
    const response: OpenClawResponse<CronStatusDTO> = {
      status: 'unavailable',
      latencyMs,
      data: null,
      error: errorMessage,
      ...classifyOpenClawError(errorMessage),
      timestamp: new Date().toISOString(),
      cached: false,
    }
    return NextResponse.json(response)
  }
}
