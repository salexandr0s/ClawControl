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

/**
 * Cron job schedule types.
 * Based on OpenClaw cron job schema from docs.openclaw.ai/automation/cron-jobs.
 */
export interface CronSchedule {
  kind: 'at' | 'every' | 'cron'
  /** Epoch ms for 'at' type */
  atMs?: number
  /** Interval in ms for 'every' type */
  everyMs?: number
  /** 5-field cron expression for 'cron' type */
  expr?: string
  /** IANA timezone */
  tz?: string
}

/**
 * Cron job payload types.
 */
export interface CronPayload {
  kind: 'systemEvent' | 'agentTurn'
  /** Text for systemEvent kind */
  text?: string
  /** Message for agentTurn kind */
  message?: string
  deliver?: boolean
  channel?: string
  to?: string
}

/**
 * Cron job DTO from OpenClaw CLI.
 * Based on `openclaw cron list --json` output.
 */
export interface CronJobDTO {
  id: string
  name: string
  schedule: CronSchedule
  sessionTarget: 'main' | 'isolated'
  wakeMode: 'now' | 'next-heartbeat'
  payload: CronPayload
  agentId?: string
  description?: string
  enabled?: boolean
  deleteAfterRun?: boolean
  lastRunAt?: string
  nextRunAt?: string
  lastStatus?: 'success' | 'failed' | 'running'
  runCount?: number
}

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
    const res = await runCommandJson<CronJobDTO[]>('cron.jobs.json', {
      timeout: OPENCLAW_TIMEOUT_MS,
    })

    const latencyMs = Date.now() - start

    if (res.error) {
      const response: OpenClawResponse<CronJobDTO[]> = {
        status: 'unavailable',
        latencyMs,
        data: null,
        error: res.error,
        timestamp: new Date().toISOString(),
        cached: false,
      }
      return NextResponse.json(response)
    }

    // CLI may return null/undefined for empty list
    const jobs = res.data ?? []

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
    const latencyMs = Date.now() - start
    const response: OpenClawResponse<CronJobDTO[]> = {
      status: 'unavailable',
      latencyMs,
      data: null,
      error: err instanceof Error ? err.message : 'Unknown error',
      timestamp: new Date().toISOString(),
      cached: false,
    }
    return NextResponse.json(response)
  }
}

export const GET = withRouteTiming('api.openclaw.cron.jobs.get', getCronJobsRoute)
