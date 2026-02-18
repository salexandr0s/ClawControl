import { NextRequest, NextResponse } from 'next/server'
import { parseJsonFromCommandOutput, runDynamicCommand } from '@clawcontrol/adapters-openclaw'
import {
  type OpenClawResponse,
  OPENCLAW_TIMEOUT_MS,
  DEGRADED_THRESHOLD_MS,
  clearCache,
} from '@/lib/openclaw/availability'
import { classifyOpenClawError } from '@/lib/openclaw/error-shape'

interface RunResult {
  jobId: string
  runId: string
  status: 'triggered' | 'queued'
  message?: string
}

/**
 * POST /api/openclaw/cron/[id]/run
 *
 * Triggers immediate execution of a cron job.
 * Returns 200 with structured OpenClawResponse.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<OpenClawResponse<RunResult>>> {
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
    const result = await runDynamicCommand('cron.run', { id: jobId }, {
      timeout: OPENCLAW_TIMEOUT_MS,
    })

    const latencyMs = Date.now() - start

    if (result.exitCode !== 0) {
      const errorMessage = result.stderr || result.error || `Command failed with exit code ${result.exitCode}`
      const details = classifyOpenClawError(errorMessage)
      return NextResponse.json({
        status: 'unavailable',
        latencyMs,
        data: null,
        error: errorMessage,
        ...details,
        timestamp: new Date().toISOString(),
        cached: false,
      })
    }

    // Clear cron jobs cache so list refreshes with new state
    clearCache('cron.jobs')

    const parsed = parseJsonFromCommandOutput<RunResult>(result.stdout)

    return NextResponse.json({
      status: latencyMs > DEGRADED_THRESHOLD_MS ? 'degraded' : 'ok',
      latencyMs,
      data: parsed ?? { jobId, runId: 'unknown', status: 'triggered' },
      error: null,
      timestamp: new Date().toISOString(),
      cached: false,
    })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    const latencyMs = Date.now() - start
    return NextResponse.json({
      status: 'unavailable',
      latencyMs,
      data: null,
      error: errorMessage,
      ...classifyOpenClawError(errorMessage),
      timestamp: new Date().toISOString(),
      cached: false,
    })
  }
}
