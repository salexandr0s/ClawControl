import { NextRequest, NextResponse } from 'next/server'
import { runDynamicCommandJson } from '@savorg/adapters-openclaw'
import {
  type OpenClawResponse,
  OPENCLAW_TIMEOUT_MS,
  DEGRADED_THRESHOLD_MS,
  clearCache,
} from '@/lib/openclaw/availability'

interface DisableResult {
  jobId: string
  enabled: boolean
  message?: string
}

/**
 * POST /api/openclaw/cron/[id]/disable
 *
 * Disables a cron job.
 * Returns 200 with structured OpenClawResponse.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<OpenClawResponse<DisableResult>>> {
  const { id: jobId } = await params

  // Validate jobId format (alphanumeric + dash/underscore)
  if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) {
    return NextResponse.json({
      status: 'unavailable',
      latencyMs: 0,
      data: null,
      error: 'Invalid job ID format',
      timestamp: new Date().toISOString(),
      cached: false,
    })
  }

  const start = Date.now()

  try {
    const res = await runDynamicCommandJson<DisableResult>('cron.disable', { id: jobId }, {
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

    // Clear cron jobs cache so list refreshes with new state
    clearCache('cron.jobs')

    return NextResponse.json({
      status: latencyMs > DEGRADED_THRESHOLD_MS ? 'degraded' : 'ok',
      latencyMs,
      data: res.data ?? { jobId, enabled: false },
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
