import { NextRequest, NextResponse } from 'next/server'
import { runDynamicCommandJson } from '@savorg/adapters-openclaw'
import {
  type OpenClawResponse,
  OPENCLAW_TIMEOUT_MS,
  DEGRADED_THRESHOLD_MS,
  clearCache,
} from '@/lib/openclaw/availability'

interface CreateResult {
  jobId: string
  name: string
  schedule: string
  enabled: boolean
  message?: string
}

/**
 * POST /api/openclaw/cron
 *
 * Creates a new cron job.
 * Returns 200 with structured OpenClawResponse.
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<OpenClawResponse<CreateResult>>> {
  const body = await request.json()
  const { name, schedule, command, enabled = true } = body

  // Validate required fields
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return NextResponse.json({
      status: 'unavailable',
      latencyMs: 0,
      data: null,
      error: 'Job name is required',
      timestamp: new Date().toISOString(),
      cached: false,
    })
  }

  if (!schedule || typeof schedule !== 'string' || schedule.trim().length === 0) {
    return NextResponse.json({
      status: 'unavailable',
      latencyMs: 0,
      data: null,
      error: 'Schedule is required',
      timestamp: new Date().toISOString(),
      cached: false,
    })
  }

  if (!command || typeof command !== 'string' || command.trim().length === 0) {
    return NextResponse.json({
      status: 'unavailable',
      latencyMs: 0,
      data: null,
      error: 'Command is required',
      timestamp: new Date().toISOString(),
      cached: false,
    })
  }

  const start = Date.now()

  try {
    const res = await runDynamicCommandJson<CreateResult>('cron.create', {
      name: name.trim(),
      schedule: schedule.trim(),
      command: command.trim(),
      enabled: enabled ? 'true' : 'false',
    }, {
      timeout: OPENCLAW_TIMEOUT_MS,
    })

    const latencyMs = Date.now() - start

    if (res.error) {
      return NextResponse.json({
        status: 'unavailable',
        latencyMs,
        data: null,
        error: res.error,
        timestamp: new Date().toISOString(),
        cached: false,
      })
    }

    // Clear cron jobs cache so list refreshes with new job
    clearCache('cron.jobs')

    return NextResponse.json({
      status: latencyMs > DEGRADED_THRESHOLD_MS ? 'degraded' : 'ok',
      latencyMs,
      data: res.data ?? { jobId: 'unknown', name, schedule, enabled },
      error: null,
      timestamp: new Date().toISOString(),
      cached: false,
    })
  } catch (err) {
    const latencyMs = Date.now() - start
    return NextResponse.json({
      status: 'unavailable',
      latencyMs,
      data: null,
      error: err instanceof Error ? err.message : 'Unknown error',
      timestamp: new Date().toISOString(),
      cached: false,
    })
  }
}
