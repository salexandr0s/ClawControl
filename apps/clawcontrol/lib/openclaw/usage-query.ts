import 'server-only'

import { prisma } from '@/lib/db'
import { getOrLoadWithCache } from '@/lib/perf/async-cache'

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

export interface UsageBreakdownGroup {
  key: string
  inputTokens: string
  outputTokens: string
  cacheReadTokens: string
  cacheWriteTokens: string
  totalTokens: string
  totalCostMicros: string
  sessionCount: number
}

export interface UsageBreakdownResult {
  from: string
  to: string
  groupBy: 'model' | 'agent'
  groups: UsageBreakdownGroup[]
}

export interface UsageBreakdownBothResult {
  from: string
  to: string
  groupBy: 'both'
  byAgent: UsageBreakdownGroup[]
  byModel: UsageBreakdownGroup[]
}

interface UsageAggregateRow {
  sessionId: string
  agentId: string
  modelKey: string
  model: string | null
  dayStart: Date
  inputTokens: bigint
  outputTokens: bigint
  cacheReadTokens: bigint
  cacheWriteTokens: bigint
  totalTokens: bigint
  totalCostMicros: bigint
}

const QUERY_TTL_MS = 15_000
const DEFAULT_RANGE_DAYS = 30
const DEFAULT_RANGE_ROUND_MS = 60_000

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

function normalizeNowMs(): number {
  return Math.floor(Date.now() / DEFAULT_RANGE_ROUND_MS) * DEFAULT_RANGE_ROUND_MS
}

function resolveRange(input: {
  from?: string | null
  to?: string | null
}): { from: Date; to: Date } {
  const roundedNow = normalizeNowMs()
  const fallbackTo = new Date(roundedNow)
  const fallbackFrom = new Date(roundedNow - DEFAULT_RANGE_DAYS * 86400_000)

  let from = parseDate(input.from, fallbackFrom)
  let to = parseDate(input.to, fallbackTo)

  if (from.getTime() > to.getTime()) {
    const swap = from
    from = to
    to = swap
  }

  return { from, to }
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

async function fetchUsageRowsRaw(from: Date, to: Date, agentId: string | null): Promise<UsageAggregateRow[]> {
  const fromDay = startOfDay(from)
  const toDay = startOfDay(to)

  return prisma.sessionUsageDailyAggregate.findMany({
    where: {
      dayStart: {
        gte: fromDay,
        lte: toDay,
      },
      ...(agentId ? { agentId } : {}),
    },
    select: {
      sessionId: true,
      agentId: true,
      modelKey: true,
      model: true,
      dayStart: true,
      inputTokens: true,
      outputTokens: true,
      cacheReadTokens: true,
      cacheWriteTokens: true,
      totalTokens: true,
      totalCostMicros: true,
    },
  })
}

async function fetchUsageRowsCached(from: Date, to: Date, agentId: string | null): Promise<UsageAggregateRow[]> {
  const key = `usage.rows:${from.toISOString()}:${to.toISOString()}:${agentId ?? 'all'}`
  const { value } = await getOrLoadWithCache(key, QUERY_TTL_MS, async () =>
    fetchUsageRowsRaw(from, to, agentId)
  )
  return value
}

function modelLabel(row: UsageAggregateRow): string {
  const label = row.model?.trim()
  if (label) return label
  if (row.modelKey?.trim()) return row.modelKey
  return 'unknown'
}

function aggregateBreakdownGroups(
  rows: UsageAggregateRow[],
  groupBy: 'model' | 'agent'
): UsageBreakdownGroup[] {
  const grouped = new Map<string, {
    label: string
    inputTokens: bigint
    outputTokens: bigint
    cacheReadTokens: bigint
    cacheWriteTokens: bigint
    totalTokens: bigint
    totalCostMicros: bigint
    sessions: Set<string>
  }>()

  for (const row of rows) {
    const normalizedKey = groupBy === 'model'
      ? (row.modelKey || 'unknown')
      : (row.agentId || 'unknown')

    const label = groupBy === 'model'
      ? modelLabel(row)
      : (row.agentId || 'unknown')

    const prev = grouped.get(normalizedKey) ?? {
      label,
      inputTokens: 0n,
      outputTokens: 0n,
      cacheReadTokens: 0n,
      cacheWriteTokens: 0n,
      totalTokens: 0n,
      totalCostMicros: 0n,
      sessions: new Set<string>(),
    }

    if (prev.label === 'unknown' && label !== 'unknown') {
      prev.label = label
    }

    prev.inputTokens += row.inputTokens
    prev.outputTokens += row.outputTokens
    prev.cacheReadTokens += row.cacheReadTokens
    prev.cacheWriteTokens += row.cacheWriteTokens
    prev.totalTokens += row.totalTokens
    prev.totalCostMicros += row.totalCostMicros
    prev.sessions.add(row.sessionId)

    grouped.set(normalizedKey, prev)
  }

  return Array.from(grouped.values())
    .map((value) => ({
      key: value.label,
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
}

export async function getUsageSummary(input: {
  range: RangeType
  from?: string | null
  to?: string | null
  agentId?: string | null
}): Promise<UsageSummaryResult> {
  const { from, to } = resolveRange({
    from: input.from,
    to: input.to,
  })
  const agentId = input.agentId ?? null

  const cacheKey = `usage.summary:${input.range}:${from.toISOString()}:${to.toISOString()}:${agentId ?? 'all'}`
  const { value } = await getOrLoadWithCache(cacheKey, QUERY_TTL_MS, async () => {
    const rows = await fetchUsageRowsCached(from, to, agentId)

    const buckets = new Map<string, {
      inputTokens: bigint
      outputTokens: bigint
      cacheReadTokens: bigint
      cacheWriteTokens: bigint
      totalTokens: bigint
      totalCostMicros: bigint
    }>()

    for (const row of rows) {
      const bucket = toBucketStart(row.dayStart, input.range)
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

    return result
  })

  return value
}

export async function getUsageBreakdown(input: {
  groupBy: 'model' | 'agent'
  from?: string | null
  to?: string | null
}): Promise<UsageBreakdownResult> {
  const { from, to } = resolveRange({
    from: input.from,
    to: input.to,
  })

  const cacheKey = `usage.breakdown:${input.groupBy}:${from.toISOString()}:${to.toISOString()}`
  const { value } = await getOrLoadWithCache(cacheKey, QUERY_TTL_MS, async () => {
    const rows = await fetchUsageRowsCached(from, to, null)
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      groupBy: input.groupBy,
      groups: aggregateBreakdownGroups(rows, input.groupBy),
    } satisfies UsageBreakdownResult
  })

  return value
}

export async function getUsageBreakdownBoth(input: {
  from?: string | null
  to?: string | null
}): Promise<UsageBreakdownBothResult> {
  const { from, to } = resolveRange({
    from: input.from,
    to: input.to,
  })

  const cacheKey = `usage.breakdown:both:${from.toISOString()}:${to.toISOString()}`
  const { value } = await getOrLoadWithCache(cacheKey, QUERY_TTL_MS, async () => {
    const rows = await fetchUsageRowsCached(from, to, null)
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      groupBy: 'both',
      byAgent: aggregateBreakdownGroups(rows, 'agent'),
      byModel: aggregateBreakdownGroups(rows, 'model'),
    } satisfies UsageBreakdownBothResult
  })

  return value
}

export type { RangeType }
