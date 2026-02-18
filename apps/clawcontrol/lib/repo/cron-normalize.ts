/**
 * Shared cron DTO normalizers for OpenClaw 2.17+ payloads.
 *
 * The CLI/gateway may return either raw arrays or wrapped objects.
 * Routes and repositories use these helpers to keep response shapes stable.
 */

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function toIsoFromMs(value: number | undefined): string | undefined {
  if (value === undefined) return undefined
  return new Date(value).toISOString()
}

function parseIsoMs(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function asMode(
  value: unknown
): 'none' | 'announce' | 'webhook' | undefined {
  if (value === 'none' || value === 'announce' || value === 'webhook') {
    return value
  }
  return undefined
}

export interface CronStatusDTO {
  enabled: boolean
  jobs: number
  nextWakeAtMs?: number
  storePath?: string
  // Compatibility fields for existing callers that still read old keys.
  running?: boolean
  jobCount?: number
  nextRun?: string
  lastRun?: string
  uptime?: number
}

export interface CronSchedule {
  kind: 'at' | 'every' | 'cron'
  atMs?: number
  everyMs?: number
  expr?: string
  tz?: string
  staggerMs?: number
  exact?: boolean
}

export interface CronPayload {
  kind: 'systemEvent' | 'agentTurn'
  text?: string
  message?: string
  deliver?: boolean
  channel?: string
  to?: string
  bestEffortDeliver?: boolean
}

export interface CronDelivery {
  mode: 'none' | 'announce' | 'webhook'
  channel?: string
  to?: string
  bestEffort?: boolean
}

export interface CronJobState {
  nextRunAtMs?: number
  runningAtMs?: number
  lastRunAtMs?: number
  lastStatus?: string
  lastError?: string
  lastDurationMs?: number
  runCount?: number
}

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
  delivery?: CronDelivery
  state?: CronJobState
  createdAtMs?: number
  updatedAtMs?: number
  lastRunAt?: string
  nextRunAt?: string
  lastStatus?: 'success' | 'failed' | 'running'
  runCount?: number
}

export interface CronRunDTO {
  id: string
  jobId: string
  startedAt: string
  endedAt?: string
  status: 'success' | 'failed' | 'running' | 'skipped'
  durationMs?: number
  exitCode?: number
  error?: string
  output?: string
}

function normalizeSchedule(value: unknown): CronSchedule {
  const schedule = isRecord(value) ? value : {}
  const kindRaw = asString(schedule.kind)
  const kind: CronSchedule['kind'] =
    kindRaw === 'at' || kindRaw === 'every' || kindRaw === 'cron'
      ? kindRaw
      : 'cron'

  if (kind === 'at') {
    return {
      kind,
      atMs: asNumber(schedule.atMs) ?? parseIsoMs(asString(schedule.at)),
    }
  }

  if (kind === 'every') {
    return {
      kind,
      everyMs: asNumber(schedule.everyMs),
    }
  }

  return {
    kind,
    expr: asString(schedule.expr),
    tz: asString(schedule.tz),
    staggerMs: asNumber(schedule.staggerMs) ?? asNumber(schedule.stagger),
    exact: asBoolean(schedule.exact),
  }
}

function normalizeDelivery(value: unknown): CronDelivery | undefined {
  const delivery = isRecord(value) ? value : null
  if (!delivery) return undefined

  const mode = asMode(delivery.mode)
  if (!mode) return undefined

  return {
    mode,
    channel: asString(delivery.channel),
    to: asString(delivery.to),
    bestEffort: asBoolean(delivery.bestEffort),
  }
}

function normalizePayload(value: unknown, delivery?: CronDelivery): CronPayload {
  const payload = isRecord(value) ? value : {}
  const kindRaw = asString(payload.kind)
  const kind: CronPayload['kind'] = kindRaw === 'systemEvent' ? 'systemEvent' : 'agentTurn'

  if (kind === 'systemEvent') {
    return {
      kind,
      text: asString(payload.text),
    }
  }

  return {
    kind,
    message: asString(payload.message) ?? asString(payload.text),
    deliver: asBoolean(payload.deliver),
    channel: asString(payload.channel) ?? delivery?.channel,
    to: asString(payload.to) ?? delivery?.to,
    bestEffortDeliver: asBoolean(payload.bestEffortDeliver) ?? delivery?.bestEffort,
  }
}

function normalizeJobState(value: unknown): CronJobState | undefined {
  if (!isRecord(value)) return undefined
  return {
    nextRunAtMs: asNumber(value.nextRunAtMs),
    runningAtMs: asNumber(value.runningAtMs),
    lastRunAtMs: asNumber(value.lastRunAtMs),
    lastStatus: asString(value.lastStatus),
    lastError: asString(value.lastError),
    lastDurationMs: asNumber(value.lastDurationMs),
    runCount: asNumber(value.runCount),
  }
}

function normalizeJobStatus(value: string | undefined): CronJobDTO['lastStatus'] | undefined {
  if (!value) return undefined
  const normalized = value.toLowerCase()
  if (normalized === 'ok' || normalized === 'success') return 'success'
  if (normalized === 'running') return 'running'
  return 'failed'
}

function normalizeRunStatus(value: string | undefined): CronRunDTO['status'] {
  const normalized = (value ?? '').toLowerCase()
  if (normalized === 'ok' || normalized === 'success') return 'success'
  if (normalized === 'running') return 'running'
  if (normalized === 'skipped') return 'skipped'
  return 'failed'
}

function normalizeJob(value: unknown): CronJobDTO | null {
  if (!isRecord(value)) return null

  const id = asString(value.id)
  if (!id) return null

  const state = normalizeJobState(value.state)
  const delivery = normalizeDelivery(value.delivery)
  const lastRunAtMs = state?.lastRunAtMs ?? parseIsoMs(asString(value.lastRunAt))
  const nextRunAtMs = state?.nextRunAtMs ?? parseIsoMs(asString(value.nextRunAt))

  return {
    id,
    name: asString(value.name) ?? id,
    schedule: normalizeSchedule(value.schedule),
    sessionTarget: value.sessionTarget === 'main' ? 'main' : 'isolated',
    wakeMode: value.wakeMode === 'next-heartbeat' ? 'next-heartbeat' : 'now',
    payload: normalizePayload(value.payload, delivery),
    agentId: asString(value.agentId),
    description: asString(value.description),
    enabled: asBoolean(value.enabled) ?? true,
    deleteAfterRun: asBoolean(value.deleteAfterRun),
    delivery,
    state,
    createdAtMs: asNumber(value.createdAtMs),
    updatedAtMs: asNumber(value.updatedAtMs),
    lastRunAt: toIsoFromMs(lastRunAtMs),
    nextRunAt: toIsoFromMs(nextRunAtMs),
    lastStatus: normalizeJobStatus(state?.lastStatus ?? asString(value.lastStatus)),
    runCount: state?.runCount ?? asNumber(value.runCount),
  }
}

export function normalizeCronJobsPayload(value: unknown): CronJobDTO[] {
  const jobs = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.jobs)
      ? value.jobs
      : []

  return jobs
    .map((entry) => normalizeJob(entry))
    .filter((entry): entry is CronJobDTO => Boolean(entry))
}

export function normalizeCronStatusPayload(value: unknown): CronStatusDTO {
  const status = isRecord(value) ? value : {}

  const enabled = asBoolean(status.enabled) ?? asBoolean(status.running) ?? false
  const jobs = asNumber(status.jobs) ?? asNumber(status.jobCount) ?? 0
  const nextWakeAtMs = asNumber(status.nextWakeAtMs) ?? parseIsoMs(asString(status.nextRun))
  const storePath = asString(status.storePath)

  return {
    enabled,
    jobs,
    nextWakeAtMs,
    storePath,
    running: enabled,
    jobCount: jobs,
    nextRun: toIsoFromMs(nextWakeAtMs) ?? asString(status.nextRun),
    lastRun: asString(status.lastRun),
    uptime: asNumber(status.uptime),
  }
}

function normalizeRunEntry(
  value: unknown,
  index: number,
  fallbackJobId: string
): CronRunDTO | null {
  if (!isRecord(value)) return null

  const jobId = asString(value.jobId) ?? fallbackJobId
  const startedAtMs =
    asNumber(value.startedAtMs)
    ?? asNumber(value.runAtMs)
    ?? asNumber(value.ts)
    ?? parseIsoMs(asString(value.startedAt))
  const startedAt = asString(value.startedAt) ?? toIsoFromMs(startedAtMs) ?? new Date().toISOString()
  const durationMs = asNumber(value.durationMs)
  const endedAtMs =
    asNumber(value.endedAtMs)
    ?? (startedAtMs !== undefined && durationMs !== undefined ? startedAtMs + durationMs : undefined)
  const endedAt = asString(value.endedAt) ?? toIsoFromMs(endedAtMs)
  const id =
    asString(value.id)
    ?? asString(value.runId)
    ?? `${jobId}:${startedAtMs ?? index}`

  return {
    id,
    jobId,
    startedAt,
    endedAt,
    status: normalizeRunStatus(asString(value.status)),
    durationMs,
    exitCode: asNumber(value.exitCode),
    error: asString(value.error),
    output: asString(value.output) ?? asString(value.summary),
  }
}

export function normalizeCronRunsPayload(
  value: unknown,
  fallbackJobId = ''
): CronRunDTO[] {
  const entries = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.entries)
      ? value.entries
      : isRecord(value) && Array.isArray(value.runs)
        ? value.runs
        : []

  return entries
    .map((entry, index) => normalizeRunEntry(entry, index, fallbackJobId))
    .filter((entry): entry is CronRunDTO => Boolean(entry))
}
