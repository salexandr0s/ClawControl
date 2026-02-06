import 'server-only'

import { prisma } from '@/lib/db'

type RangeType = 'daily' | 'weekly' | 'monthly'

interface UsageBucket {
  bucketStart: string
  inputTokens: string
  outputTokens: string
  cacheReadTokens: string
  cacheWriteTokens: string
  totalTokens: string
  totalCostMicros: string
}

export interface UsageSummaryResult {
  range: RangeType
  from: string
  to: string
  agentId: string | null
  totals: {
    inputTokens: string
    outputTokens: string
    cacheReadTokens: string
    cacheWriteTokens: string
    totalTokens: string
    totalCostMicros: string
    cacheEfficiencyPct: number
  }
  series: UsageBucket[]
}

export interface UsageBreakdownResult {
  from: string
  to: string
  groupBy: 'model' | 'agent'
  groups: Array<{
    key: string
    inputTokens: string
    outputTokens: string
    cacheReadTokens: string
    cacheWriteTokens: string
    totalTokens: string
    totalCostMicros: string
    sessionCount: number
  }>
}

const QUERY_TTL_MS = 15_000
const queryCache = new Map<string, { expiresAt: number; value: unknown }>()

function cacheGet<T>(key: string): T | null {
  const found = queryCache.get(key)
  if (!found) return null
  if (found.expiresAt < Date.now()) {
    queryCache.delete(key)
    return null
  }
  return found.value as T
}

function cacheSet<T>(key: string, value: T): void {
  queryCache.set(key, {
    expiresAt: Date.now() + QUERY_TTL_MS,
    value,
  })
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function startOfWeek(date: Date): Date {
  const utcDay = date.getUTCDay()
  const mondayOffset = utcDay === 0 ? -6 : 1 - utcDay
  const dayStart = startOfDay(date)
  dayStart.setUTCDate(dayStart.getUTCDate() + mondayOffset)
  return dayStart
}

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

function toBucketStart(date: Date, range: RangeType): Date {
  if (range === 'weekly') return startOfWeek(date)
  if (range === 'monthly') return startOfMonth(date)
  return startOfDay(date)
}

function parseDate(input: string | null | undefined, fallback: Date): Date {
  if (!input) return fallback
  const d = new Date(input)
  return Number.isNaN(d.getTime()) ? fallback : d
}

function sumBigints(values: bigint[]): bigint {
  return values.reduce((acc, v) => acc + v, 0n)
}

function toStr(v: bigint): string {
  return v.toString()
}

function computeCacheEfficiency(cacheReadTokens: bigint, inputTokens: bigint): number {
  const denom = cacheReadTokens + inputTokens
  if (denom <= 0n) return 0
  return Number((cacheReadTokens * 10_000n) / denom) / 100
}

async function fetchUsageRows(from: Date, to: Date, agentId: string | null) {
  return prisma.sessionUsageAggregate.findMany({
    where: {
      lastSeenAt: {
        gte: from,
        lte: to,
      },
      ...(agentId ? { agentId } : {}),
    },
    select: {
      agentId: true,
      model: true,
      inputTokens: true,
      outputTokens: true,
      cacheReadTokens: true,
      cacheWriteTokens: true,
      totalTokens: true,
      totalCostMicros: true,
      lastSeenAt: true,
      sessionId: true,
    },
  })
}

export async function getUsageSummary(input: {
  range: RangeType
  from?: string | null
  to?: string | null
  agentId?: string | null
}): Promise<UsageSummaryResult> {
  const now = new Date()
  const defaultFrom = new Date(now.getTime() - 30 * 86400_000)
  const from = parseDate(input.from, defaultFrom)
  const to = parseDate(input.to, now)
  const agentId = input.agentId ?? null

  const cacheKey = `summary:${input.range}:${from.toISOString()}:${to.toISOString()}:${agentId ?? 'all'}`
  const cached = cacheGet<UsageSummaryResult>(cacheKey)
  if (cached) return cached

  const rows = await fetchUsageRows(from, to, agentId)

  const buckets = new Map<string, {
    inputTokens: bigint
    outputTokens: bigint
    cacheReadTokens: bigint
    cacheWriteTokens: bigint
    totalTokens: bigint
    totalCostMicros: bigint
  }>()

  for (const row of rows) {
    if (!row.lastSeenAt) continue
    const bucket = toBucketStart(row.lastSeenAt, input.range)
    const key = bucket.toISOString()
    const prev = buckets.get(key) ?? {
      inputTokens: 0n,
      outputTokens: 0n,
      cacheReadTokens: 0n,
      cacheWriteTokens: 0n,
      totalTokens: 0n,
      totalCostMicros: 0n,
    }

    prev.inputTokens += row.inputTokens
    prev.outputTokens += row.outputTokens
    prev.cacheReadTokens += row.cacheReadTokens
    prev.cacheWriteTokens += row.cacheWriteTokens
    prev.totalTokens += row.totalTokens
    prev.totalCostMicros += row.totalCostMicros

    buckets.set(key, prev)
  }

  const series = Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucketStart, values]) => ({
      bucketStart,
      inputTokens: toStr(values.inputTokens),
      outputTokens: toStr(values.outputTokens),
      cacheReadTokens: toStr(values.cacheReadTokens),
      cacheWriteTokens: toStr(values.cacheWriteTokens),
      totalTokens: toStr(values.totalTokens),
      totalCostMicros: toStr(values.totalCostMicros),
    }))

  const totals = {
    inputTokens: sumBigints(rows.map((r) => r.inputTokens)),
    outputTokens: sumBigints(rows.map((r) => r.outputTokens)),
    cacheReadTokens: sumBigints(rows.map((r) => r.cacheReadTokens)),
    cacheWriteTokens: sumBigints(rows.map((r) => r.cacheWriteTokens)),
    totalTokens: sumBigints(rows.map((r) => r.totalTokens)),
    totalCostMicros: sumBigints(rows.map((r) => r.totalCostMicros)),
  }

  const result: UsageSummaryResult = {
    range: input.range,
    from: from.toISOString(),
    to: to.toISOString(),
    agentId,
    totals: {
      inputTokens: toStr(totals.inputTokens),
      outputTokens: toStr(totals.outputTokens),
      cacheReadTokens: toStr(totals.cacheReadTokens),
      cacheWriteTokens: toStr(totals.cacheWriteTokens),
      totalTokens: toStr(totals.totalTokens),
      totalCostMicros: toStr(totals.totalCostMicros),
      cacheEfficiencyPct: computeCacheEfficiency(totals.cacheReadTokens, totals.inputTokens),
    },
    series,
  }

  cacheSet(cacheKey, result)
  return result
}

export async function getUsageBreakdown(input: {
  groupBy: 'model' | 'agent'
  from?: string | null
  to?: string | null
}): Promise<UsageBreakdownResult> {
  const now = new Date()
  const defaultFrom = new Date(now.getTime() - 30 * 86400_000)
  const from = parseDate(input.from, defaultFrom)
  const to = parseDate(input.to, now)

  const cacheKey = `breakdown:${input.groupBy}:${from.toISOString()}:${to.toISOString()}`
  const cached = cacheGet<UsageBreakdownResult>(cacheKey)
  if (cached) return cached

  const rows = await fetchUsageRows(from, to, null)

  const grouped = new Map<string, {
    inputTokens: bigint
    outputTokens: bigint
    cacheReadTokens: bigint
    cacheWriteTokens: bigint
    totalTokens: bigint
    totalCostMicros: bigint
    sessions: Set<string>
  }>()

  for (const row of rows) {
    const key = input.groupBy === 'model'
      ? (row.model || 'unknown')
      : row.agentId

    const prev = grouped.get(key) ?? {
      inputTokens: 0n,
      outputTokens: 0n,
      cacheReadTokens: 0n,
      cacheWriteTokens: 0n,
      totalTokens: 0n,
      totalCostMicros: 0n,
      sessions: new Set<string>(),
    }

    prev.inputTokens += row.inputTokens
    prev.outputTokens += row.outputTokens
    prev.cacheReadTokens += row.cacheReadTokens
    prev.cacheWriteTokens += row.cacheWriteTokens
    prev.totalTokens += row.totalTokens
    prev.totalCostMicros += row.totalCostMicros
    prev.sessions.add(row.sessionId)

    grouped.set(key, prev)
  }

  const groups = Array.from(grouped.entries())
    .map(([key, value]) => ({
      key,
      inputTokens: toStr(value.inputTokens),
      outputTokens: toStr(value.outputTokens),
      cacheReadTokens: toStr(value.cacheReadTokens),
      cacheWriteTokens: toStr(value.cacheWriteTokens),
      totalTokens: toStr(value.totalTokens),
      totalCostMicros: toStr(value.totalCostMicros),
      sessionCount: value.sessions.size,
    }))
    .sort((a, b) => {
      const aCost = BigInt(a.totalCostMicros)
      const bCost = BigInt(b.totalCostMicros)
      if (aCost === bCost) return 0
      return aCost > bCost ? -1 : 1
    })

  const result: UsageBreakdownResult = {
    from: from.toISOString(),
    to: to.toISOString(),
    groupBy: input.groupBy,
    groups,
  }

  cacheSet(cacheKey, result)
  return result
}

export type { RangeType }
