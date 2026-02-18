import { NextResponse } from 'next/server'
import { runCommandJson } from '@clawcontrol/adapters-openclaw'
import {
  type OpenClawResponse,
  OPENCLAW_TIMEOUT_MS,
  DEGRADED_THRESHOLD_MS,
  getCached,
  setCache,
} from '@/lib/openclaw/availability'
import { withRouteTiming } from '@/lib/perf/route-timing'
import { classifyOpenClawError } from '@/lib/openclaw/error-shape'
import { normalizeCronJobsPayload, type CronJobDTO } from '@/lib/repo/cron-normalize'

const CACHE_KEY = 'cron.jobs'

/**
 * GET /api/openclaw/cron/jobs
 *
 * Returns list of cron jobs with explicit availability semantics.
 * Always returns 200 with structured OpenClawResponse (not 500).
 */
const getCronJobsRoute = async (): Promise<NextResponse<OpenClawResponse<CronJobDTO[]>>> => {
  // Check cache first (15s TTL to prevent refresh cascade)
  const cached = getCached<CronJobDTO[]>(CACHE_KEY)
  if (cached) {
    return NextResponse.json(cached)
  }

  const start = Date.now()

  try {
    const res = await runCommandJson<unknown>('cron.jobs.json', {
      timeout: OPENCLAW_TIMEOUT_MS,
    })

    const latencyMs = Date.now() - start

    if (res.error) {
      const details = classifyOpenClawError(res.error)
      const response: OpenClawResponse<CronJobDTO[]> = {
        status: 'unavailable',
        latencyMs,
        data: null,
        error: res.error,
        ...details,
        timestamp: new Date().toISOString(),
        cached: false,
      }
      return NextResponse.json(response)
    }

    const jobs = normalizeCronJobsPayload(res.data)

    const response: OpenClawResponse<CronJobDTO[]> = {
      status: latencyMs > DEGRADED_THRESHOLD_MS ? 'degraded' : 'ok',
      latencyMs,
      data: jobs,
      error: null,
      timestamp: new Date().toISOString(),
      cached: false,
    }

    setCache(CACHE_KEY, response)
    return NextResponse.json(response)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    const latencyMs = Date.now() - start
    const response: OpenClawResponse<CronJobDTO[]> = {
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

export const GET = withRouteTiming('api.openclaw.cron.jobs.get', getCronJobsRoute)
