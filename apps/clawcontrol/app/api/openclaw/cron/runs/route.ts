import { NextRequest, NextResponse } from 'next/server'
import { runDynamicCommandJson } from '@clawcontrol/adapters-openclaw'
import {
  type OpenClawResponse,
  OPENCLAW_TIMEOUT_MS,
  DEGRADED_THRESHOLD_MS,
  getCached,
  setCache,
} from '@/lib/openclaw/availability'
import { classifyOpenClawError } from '@/lib/openclaw/error-shape'
import { normalizeCronRunsPayload, type CronRunDTO } from '@/lib/repo/cron-normalize'

/**
 * GET /api/openclaw/cron/runs?id=<jobId>
 *
 * Returns run history for a specific cron job.
 * The `id` query parameter is REQUIRED.
 *
 * Always returns 200 with structured OpenClawResponse (not 500).
 */
export async function GET(request: NextRequest): Promise<NextResponse<OpenClawResponse<CronRunDTO[]> | { error: string }>> {
  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get('id')
  const limitRaw = searchParams.get('limit')

  // id parameter is required (CLI requires --id flag)
  if (!jobId) {
    return NextResponse.json(
      { error: 'Missing required parameter: id' },
      { status: 400 }
    )
  }

  // Validate jobId format (alphanumeric + dash/underscore)
  if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) {
    return NextResponse.json(
      { error: 'Invalid job ID format' },
      { status: 400 }
    )
  }

  let limit: number | undefined
  if (limitRaw && limitRaw.trim()) {
    const parsedLimit = Number(limitRaw)
    if (!Number.isInteger(parsedLimit) || parsedLimit <= 0 || parsedLimit > 1000) {
      return NextResponse.json(
        { error: 'Invalid limit parameter' },
        { status: 400 }
      )
    }
    limit = parsedLimit
  }

  const cacheKey = limit !== undefined ? `cron.runs.${jobId}.${limit}` : `cron.runs.${jobId}`

  // Check cache first (15s TTL to prevent refresh cascade)
  const cached = getCached<CronRunDTO[]>(cacheKey)
  if (cached) {
    return NextResponse.json(cached)
  }

  const start = Date.now()

  try {
    const params: Record<string, string> = { id: jobId }
    if (limit !== undefined) params.limit = String(limit)

    const res = await runDynamicCommandJson<unknown>('cron.runs', params, {
      timeout: OPENCLAW_TIMEOUT_MS,
    })

    const latencyMs = Date.now() - start

    if (res.error) {
      const details = classifyOpenClawError(res.error)
      const response: OpenClawResponse<CronRunDTO[]> = {
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

    const runs = normalizeCronRunsPayload(res.data, jobId)

    const response: OpenClawResponse<CronRunDTO[]> = {
      status: latencyMs > DEGRADED_THRESHOLD_MS ? 'degraded' : 'ok',
      latencyMs,
      data: runs,
      error: null,
      timestamp: new Date().toISOString(),
      cached: false,
    }

    setCache(cacheKey, response)
    return NextResponse.json(response)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    const latencyMs = Date.now() - start
    const response: OpenClawResponse<CronRunDTO[]> = {
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
