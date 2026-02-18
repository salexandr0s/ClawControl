import { NextRequest, NextResponse } from 'next/server'
import { runDynamicCommandJson } from '@clawcontrol/adapters-openclaw'
import {
  type OpenClawResponse,
  OPENCLAW_TIMEOUT_MS,
  DEGRADED_THRESHOLD_MS,
  clearCache,
} from '@/lib/openclaw/availability'
import { classifyOpenClawError } from '@/lib/openclaw/error-shape'

type CreateSchedule = {
  kind: 'cron' | 'every' | 'at'
  expr?: string
  every?: string
  at?: string
  tz?: string
  stagger?: string
  exact?: boolean
}

type CreatePayload = {
  kind: 'agentTurn' | 'systemEvent'
  text: string
}

type CreateDelivery = {
  mode: 'none' | 'announce' | 'webhook'
  channel?: string
  to?: string
  bestEffort?: boolean
}

interface CronCreateRequestBody {
  name: string
  enabled?: boolean
  schedule: CreateSchedule
  payload: CreatePayload
  sessionTarget: 'isolated' | 'main'
  wakeMode?: 'now' | 'next-heartbeat'
  delivery?: CreateDelivery
}

interface LegacyCronCreateRequestBody {
  name: string
  schedule: string
  command: string
  enabled?: boolean
}

interface CreateResult {
  jobId: string
  name: string
  schedule: string
  enabled: boolean
  message?: string
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unavailable(error: string): OpenClawResponse<CreateResult> {
  return {
    status: 'unavailable',
    latencyMs: 0,
    data: null,
    error,
    timestamp: new Date().toISOString(),
    cached: false,
  }
}

function isLegacyBody(value: unknown): value is LegacyCronCreateRequestBody {
  if (!isRecord(value)) return false
  return typeof value.name === 'string'
    && typeof value.schedule === 'string'
    && typeof value.command === 'string'
}

function normalizeBody(
  body: unknown
): { ok: true; value: CronCreateRequestBody } | { ok: false; error: string } {
  if (isLegacyBody(body)) {
    if (!body.name.trim()) return { ok: false, error: 'Job name is required' }
    if (!body.schedule.trim()) return { ok: false, error: 'Schedule is required' }
    if (!body.command.trim()) return { ok: false, error: 'Command is required' }

    return {
      ok: true,
      value: {
        name: body.name.trim(),
        enabled: body.enabled ?? true,
        schedule: {
          kind: 'cron',
          expr: body.schedule.trim(),
        },
        payload: {
          kind: 'agentTurn',
          text: body.command.trim(),
        },
        sessionTarget: 'isolated',
        wakeMode: 'now',
        delivery: { mode: 'none' },
      },
    }
  }

  if (!isRecord(body)) return { ok: false, error: 'Invalid JSON body' }
  if (typeof body.name !== 'string' || !body.name.trim()) {
    return { ok: false, error: 'Job name is required' }
  }

  if (!isRecord(body.schedule)) {
    return { ok: false, error: 'schedule object is required' }
  }

  if (!isRecord(body.payload)) {
    return { ok: false, error: 'payload object is required' }
  }

  const scheduleKind = body.schedule.kind
  if (scheduleKind !== 'cron' && scheduleKind !== 'every' && scheduleKind !== 'at') {
    return { ok: false, error: 'schedule.kind must be cron, every, or at' }
  }

  if (scheduleKind === 'cron' && (typeof body.schedule.expr !== 'string' || !body.schedule.expr.trim())) {
    return { ok: false, error: 'schedule.expr is required for cron schedules' }
  }

  if (scheduleKind === 'every' && (typeof body.schedule.every !== 'string' || !body.schedule.every.trim())) {
    return { ok: false, error: 'schedule.every is required for every schedules' }
  }

  if (scheduleKind === 'at' && (typeof body.schedule.at !== 'string' || !body.schedule.at.trim())) {
    return { ok: false, error: 'schedule.at is required for at schedules' }
  }

  const payloadKind = body.payload.kind
  if (payloadKind !== 'agentTurn' && payloadKind !== 'systemEvent') {
    return { ok: false, error: 'payload.kind must be agentTurn or systemEvent' }
  }
  if (typeof body.payload.text !== 'string' || !body.payload.text.trim()) {
    return { ok: false, error: 'payload.text is required' }
  }

  const sessionTarget = body.sessionTarget
  if (sessionTarget !== 'isolated' && sessionTarget !== 'main') {
    return { ok: false, error: 'sessionTarget must be isolated or main' }
  }

  if (sessionTarget === 'main' && payloadKind !== 'systemEvent') {
    return { ok: false, error: 'main sessionTarget requires payload.kind=systemEvent' }
  }
  if (sessionTarget === 'isolated' && payloadKind !== 'agentTurn') {
    return { ok: false, error: 'isolated sessionTarget requires payload.kind=agentTurn' }
  }

  const wakeMode = body.wakeMode ?? 'now'
  if (wakeMode !== 'now' && wakeMode !== 'next-heartbeat') {
    return { ok: false, error: 'wakeMode must be now or next-heartbeat' }
  }

  let delivery: CreateDelivery | undefined
  if (body.delivery !== undefined) {
    if (!isRecord(body.delivery)) return { ok: false, error: 'delivery must be an object' }
    const mode = body.delivery.mode
    if (mode !== 'none' && mode !== 'announce' && mode !== 'webhook') {
      return { ok: false, error: 'delivery.mode must be none, announce, or webhook' }
    }
    delivery = {
      mode,
      channel: typeof body.delivery.channel === 'string' ? body.delivery.channel : undefined,
      to: typeof body.delivery.to === 'string' ? body.delivery.to : undefined,
      bestEffort: typeof body.delivery.bestEffort === 'boolean' ? body.delivery.bestEffort : undefined,
    }
  }

  const normalized: CronCreateRequestBody = {
    name: body.name.trim(),
    enabled: typeof body.enabled === 'boolean' ? body.enabled : true,
    schedule: {
      kind: scheduleKind,
      expr: typeof body.schedule.expr === 'string' ? body.schedule.expr.trim() : undefined,
      every: typeof body.schedule.every === 'string' ? body.schedule.every.trim() : undefined,
      at: typeof body.schedule.at === 'string' ? body.schedule.at.trim() : undefined,
      tz: typeof body.schedule.tz === 'string' ? body.schedule.tz.trim() : undefined,
      stagger: typeof body.schedule.stagger === 'string' ? body.schedule.stagger.trim() : undefined,
      exact: typeof body.schedule.exact === 'boolean' ? body.schedule.exact : undefined,
    },
    payload: {
      kind: payloadKind,
      text: body.payload.text.trim(),
    },
    sessionTarget,
    wakeMode,
    delivery: delivery ?? { mode: 'none' },
  }

  if (normalized.delivery.mode !== 'none' && normalized.sessionTarget !== 'isolated') {
    return { ok: false, error: 'delivery modes announce/webhook require sessionTarget=isolated' }
  }

  return { ok: true, value: normalized }
}

function buildCreateParams(input: CronCreateRequestBody): Record<string, string> {
  const params: Record<string, string> = {
    name: input.name,
    session: input.sessionTarget,
    wake: input.wakeMode ?? 'now',
  }

  if (input.enabled === false) {
    params.disabled = 'true'
  }

  if (input.schedule.kind === 'cron' && input.schedule.expr) {
    params.cron = input.schedule.expr
    if (input.schedule.tz) params.tz = input.schedule.tz
    if (input.schedule.stagger) params.stagger = input.schedule.stagger
    if (input.schedule.exact) params.exact = 'true'
  } else if (input.schedule.kind === 'every' && input.schedule.every) {
    params.every = input.schedule.every
  } else if (input.schedule.kind === 'at' && input.schedule.at) {
    params.at = input.schedule.at
  }

  if (input.payload.kind === 'systemEvent') {
    params['system-event'] = input.payload.text
  } else {
    params.message = input.payload.text
  }

  const delivery = input.delivery ?? { mode: 'none' as const }
  if (delivery.mode === 'none') {
    params['no-deliver'] = 'true'
  } else {
    params.announce = 'true'
    if (delivery.mode === 'webhook' && !delivery.channel) {
      params.channel = 'webhook'
    }
  }
  if (delivery.channel) params.channel = delivery.channel
  if (delivery.to) params.to = delivery.to
  if (delivery.bestEffort === true) {
    params['best-effort-deliver'] = 'true'
  } else if (delivery.bestEffort === false) {
    params['no-best-effort-deliver'] = 'true'
  }

  return params
}

function describeSchedule(schedule: CreateSchedule): string {
  if (schedule.kind === 'cron') return schedule.expr ?? 'cron'
  if (schedule.kind === 'every') return `every ${schedule.every ?? ''}`.trim()
  return schedule.at ?? 'at'
}

function normalizeCreateResult(
  raw: unknown,
  fallback: { name: string; schedule: string; enabled: boolean }
): CreateResult {
  if (isRecord(raw)) {
    const jobId =
      (typeof raw.jobId === 'string' && raw.jobId)
      || (typeof raw.id === 'string' && raw.id)
      || 'unknown'
    const message =
      (typeof raw.message === 'string' && raw.message)
      || undefined
    return {
      jobId,
      name: fallback.name,
      schedule: fallback.schedule,
      enabled: fallback.enabled,
      message,
    }
  }

  return {
    jobId: 'unknown',
    name: fallback.name,
    schedule: fallback.schedule,
    enabled: fallback.enabled,
  }
}

/**
 * POST /api/openclaw/cron
 *
 * Creates a new cron job.
 * Accepts the OpenClaw 2.17+ request shape plus one-release legacy shim:
 * `{ name, schedule, command, enabled }`.
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<OpenClawResponse<CreateResult>>> {
  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json(unavailable('Invalid JSON body'))
  }

  const normalized = normalizeBody(rawBody)
  if (!normalized.ok) {
    return NextResponse.json(unavailable(normalized.error))
  }

  const input = normalized.value
  const params = buildCreateParams(input)
  const fallback = {
    name: input.name,
    schedule: describeSchedule(input.schedule),
    enabled: input.enabled !== false,
  }

  const start = Date.now()

  try {
    const res = await runDynamicCommandJson<unknown>('cron.create', params, {
      timeout: OPENCLAW_TIMEOUT_MS,
    })

    const latencyMs = Date.now() - start

    if (res.error) {
      const details = classifyOpenClawError(res.error)
      return NextResponse.json({
        status: 'unavailable',
        latencyMs,
        data: null,
        error: res.error,
        ...details,
        timestamp: new Date().toISOString(),
        cached: false,
      })
    }

    clearCache('cron.jobs')

    return NextResponse.json({
      status: latencyMs > DEGRADED_THRESHOLD_MS ? 'degraded' : 'ok',
      latencyMs,
      data: normalizeCreateResult(res.data, fallback),
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
