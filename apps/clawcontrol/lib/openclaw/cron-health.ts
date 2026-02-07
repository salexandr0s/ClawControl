import 'server-only'

import { createReadStream } from 'node:fs'
import { promises as fsp } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { getOrLoadWithCache } from '@/lib/perf/async-cache'

interface CronJobState {
  lastRunAtMs?: number
  nextRunAtMs?: number
  lastStatus?: string
  runCount?: number
  lastDurationMs?: number
}

interface CronJobRecord {
  id: string
  name: string
  enabled?: boolean
  description?: string
  agentId?: string
  state?: CronJobState
}

interface CronRunRecord {
  ts?: number
  runAtMs?: number
  status?: string
  error?: string
  summary?: string
}

export interface CronJobHealth {
  id: string
  name: string
  enabled: boolean
  agentId: string | null
  successRatePct: number
  failureCount: number
  successCount: number
  consideredRunCount: number
  lastFailureReason: string | null
  lastFailureAt: string | null
  failureTrend: 'up' | 'flat' | 'down'
  rollingFailures: number[]
  flakinessScore: number
  isFlaky: boolean
  lastStatus: string | null
}

export interface CronHealthReport {
  days: number
  generatedAt: string
  summary: {
    jobsTotal: number
    jobsWithFailures: number
    flakyJobs: number
    avgSuccessRatePct: number
    totalFailures: number
  }
  jobs: CronJobHealth[]
}

const CRON_HEALTH_CACHE_TTL_MS = 10_000
const CRON_HEALTH_MAX_CONCURRENCY = 8

function getOpenClawHome(): string {
  return process.env.OPENCLAW_HOME || join(homedir(), '.openclaw')
}

function toDateMs(run: CronRunRecord): number | null {
  const ms = run.runAtMs ?? run.ts
  return typeof ms === 'number' && Number.isFinite(ms) ? ms : null
}

function isSuccess(status: string | undefined): boolean {
  if (!status) return false
  const s = status.toLowerCase()
  return s === 'ok' || s === 'success'
}

function isFailure(status: string | undefined): boolean {
  if (!status) return false
  const s = status.toLowerCase()
  return s === 'error' || s === 'failed' || s === 'failure'
}

function sanitizeReason(value: string | null | undefined): string | null {
  if (!value) return null
  let cleaned = ''
  for (const ch of value) {
    const code = ch.charCodeAt(0)
    cleaned += (code <= 31 || code === 127) ? ' ' : ch
  }
  return cleaned.trim().slice(0, 220) || null
}

async function readJobs(): Promise<CronJobRecord[]> {
  const filePath = join(getOpenClawHome(), 'cron', 'jobs.json')

  let raw: string
  try {
    raw = await fsp.readFile(filePath, 'utf8')
  } catch {
    return []
  }

  try {
    const parsed = JSON.parse(raw) as { jobs?: CronJobRecord[] } | CronJobRecord[]
    if (Array.isArray(parsed)) return parsed
    if (Array.isArray(parsed.jobs)) return parsed.jobs
    return []
  } catch {
    return []
  }
}

async function readRunsForJob(jobId: string, fromMs: number): Promise<CronRunRecord[]> {
  const filePath = join(getOpenClawHome(), 'cron', 'runs', `${jobId}.jsonl`)

  try {
    await fsp.access(filePath)
  } catch {
    return []
  }

  const runs: CronRunRecord[] = []
  const stream = createReadStream(filePath, { encoding: 'utf8' })
  const reader = createInterface({ input: stream, crlfDelay: Infinity })

  for await (const line of reader) {
    const trimmed = line.trim()
    if (!trimmed) continue

    try {
      const parsed = JSON.parse(trimmed) as CronRunRecord
      const ts = toDateMs(parsed)
      if (ts === null || ts < fromMs) continue
      runs.push(parsed)
    } catch {
      continue
    }
  }

  runs.sort((a, b) => (toDateMs(a) ?? 0) - (toDateMs(b) ?? 0))
  return runs
}

function computeRollingFailures(runs: CronRunRecord[], days: number, nowMs: number): number[] {
  const buckets = Array.from({ length: days }, () => 0)
  const dayMs = 86400_000

  for (const run of runs) {
    if (!isFailure(run.status)) continue
    const ts = toDateMs(run)
    if (ts === null) continue
    const ageDays = Math.floor((nowMs - ts) / dayMs)
    if (ageDays < 0 || ageDays >= days) continue
    const idx = days - 1 - ageDays
    buckets[idx]++
  }

  return buckets
}

function computeFailureTrend(rollingFailures: number[]): 'up' | 'flat' | 'down' {
  if (rollingFailures.length < 4) return 'flat'
  const split = Math.floor(rollingFailures.length / 2)
  const older = rollingFailures.slice(0, split).reduce((a, b) => a + b, 0)
  const newer = rollingFailures.slice(split).reduce((a, b) => a + b, 0)

  if (newer > older) return 'up'
  if (newer < older) return 'down'
  return 'flat'
}

function computeFlakinessScore(runs: CronRunRecord[]): number {
  const outcomes = runs
    .map((r) => (isSuccess(r.status) ? 'success' : isFailure(r.status) ? 'failure' : null))
    .filter((o): o is 'success' | 'failure' => o !== null)

  if (outcomes.length < 2) return 0

  let alternations = 0
  for (let i = 1; i < outcomes.length; i++) {
    if (outcomes[i] !== outcomes[i - 1]) alternations++
  }

  const failures = outcomes.filter((o) => o === 'failure').length
  const alternationRatio = alternations / (outcomes.length - 1)
  const failureRate = failures / outcomes.length

  const score = alternationRatio * 0.6 + failureRate * 0.4
  return Math.round(Math.min(1, score) * 100) / 100
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return []

  const safeLimit = Math.max(1, Math.min(limit, items.length))
  const results = new Array<R>(items.length)
  let nextIndex = 0

  await Promise.all(
    Array.from({ length: safeLimit }, async () => {
      while (true) {
        const current = nextIndex
        nextIndex += 1
        if (current >= items.length) return
        results[current] = await mapper(items[current], current)
      }
    })
  )

  return results
}

export async function getCronHealth(days = 7): Promise<CronHealthReport> {
  const safeDays = Number.isFinite(days) ? Math.max(1, Math.min(30, Math.floor(days))) : 7
  const { value } = await getOrLoadWithCache(
    `cron.health:${safeDays}`,
    CRON_HEALTH_CACHE_TTL_MS,
    async () => {
      const nowMs = Date.now()
      const fromMs = nowMs - safeDays * 86400_000

      const jobs = await readJobs()

      const healthRows = await mapWithConcurrency(
        jobs,
        CRON_HEALTH_MAX_CONCURRENCY,
        async (job): Promise<CronJobHealth> => {
          const runs = await readRunsForJob(job.id, fromMs)

          const successCount = runs.filter((r) => isSuccess(r.status)).length
          const failureRuns = runs.filter((r) => isFailure(r.status))
          const failureCount = failureRuns.length
          const consideredRunCount = successCount + failureCount

          const successRatePct =
            consideredRunCount === 0 ? 100 : Math.round((successCount / consideredRunCount) * 10_000) / 100

          const lastFailure = [...failureRuns]
            .sort((a, b) => (toDateMs(b) ?? 0) - (toDateMs(a) ?? 0))[0]

          const lastFailureReason = sanitizeReason(lastFailure?.error ?? lastFailure?.summary)
          const lastFailureAtMs = toDateMs(lastFailure ?? {})

          const rollingFailures = computeRollingFailures(runs, safeDays, nowMs)
          const flakinessScore = computeFlakinessScore(runs)

          return {
            id: job.id,
            name: job.name,
            enabled: job.enabled ?? true,
            agentId: job.agentId ?? null,
            successRatePct,
            failureCount,
            successCount,
            consideredRunCount,
            lastFailureReason,
            lastFailureAt: lastFailureAtMs ? new Date(lastFailureAtMs).toISOString() : null,
            failureTrend: computeFailureTrend(rollingFailures),
            rollingFailures,
            flakinessScore,
            isFlaky: consideredRunCount >= 4 && flakinessScore >= 0.6,
            lastStatus: job.state?.lastStatus ?? null,
          }
        }
      )

      const totalFailures = healthRows.reduce((sum, row) => sum + row.failureCount, 0)
      const jobsWithFailures = healthRows.filter((row) => row.failureCount > 0).length
      const flakyJobs = healthRows.filter((row) => row.isFlaky).length
      const avgSuccessRatePct =
        healthRows.length === 0
          ? 100
          : Math.round((healthRows.reduce((sum, row) => sum + row.successRatePct, 0) / healthRows.length) * 100) / 100

      return {
        days: safeDays,
        generatedAt: new Date().toISOString(),
        summary: {
          jobsTotal: healthRows.length,
          jobsWithFailures,
          flakyJobs,
          avgSuccessRatePct,
          totalFailures,
        },
        jobs: healthRows,
      }
    }
  )

  return value
}
