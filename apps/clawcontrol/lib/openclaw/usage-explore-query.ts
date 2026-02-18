import 'server-only'

import { prisma } from '@/lib/db'
import { getOrLoadWithCache } from '@/lib/perf/async-cache'

const QUERY_TTL_MS = 15_000
const DEFAULT_RANGE_DAYS = 30
const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200
const SQLITE_IN_LIMIT = 900

export type UsageExploreSort = 'cost_desc' | 'tokens_desc' | 'recent_desc'
export type UsageExploreBreakdownKey = 'agent' | 'model' | 'provider' | 'source' | 'sessionClass' | 'tool'

export interface UsageExploreFiltersInput {
  from?: string | null
  to?: string | null
  timezone?: string | null
  agentId?: string | null
  sessionClass?: string | null
  source?: string | null
  channel?: string | null
  sessionKind?: string | null
  providerKey?: string | null
  modelKey?: string | null
  toolName?: string | null
  hasErrors?: boolean | null
  q?: string | null
  page?: number | null
  pageSize?: number | null
  sort?: UsageExploreSort | null
}

export interface UsageExploreSummaryResult {
  from: string
  to: string
  timezone: string
  filters: UsageExploreFilterEcho
  totals: {
    inputTokens: string
    outputTokens: string
    cacheReadTokens: string
    cacheWriteTokens: string
    totalTokens: string
    totalCostMicros: string
    cacheEfficiencyPct: number
    sessionCount: number
    avgTokensPerDay: string
    avgCostMicrosPerDay: string
  }
  series: Array<{
    dayStart: string
    inputTokens: string
    outputTokens: string
    cacheReadTokens: string
    cacheWriteTokens: string
    totalTokens: string
    totalCostMicros: string
  }>
}

export interface UsageExploreBreakdownGroup {
  key: string
  inputTokens: string
  outputTokens: string
  cacheReadTokens: string
  cacheWriteTokens: string
  totalTokens: string
  totalCostMicros: string
  sessionCount: number
  toolCallCount?: string
}

export interface UsageExploreBreakdownResult {
  from: string
  to: string
  timezone: string
  filters: UsageExploreFilterEcho
  groupBy: UsageExploreBreakdownKey
  groups: UsageExploreBreakdownGroup[]
}

export interface UsageExploreActivityResult {
  from: string
  to: string
  timezone: string
  filters: UsageExploreFilterEcho
  totals: {
    totalTokens: string
    totalCostMicros: string
  }
  weekdays: Array<{
    weekday: number
    label: string
    totalTokens: string
    totalCostMicros: string
  }>
  hours: Array<{
    hour: number
    totalTokens: string
    totalCostMicros: string
  }>
}

export interface UsageExploreSessionRow {
  sessionId: string
  agentId: string
  sessionKey: string | null
  source: string | null
  channel: string | null
  sessionKind: string | null
  sessionClass: string | null
  providerKey: string | null
  operationId: string | null
  workOrderId: string | null
  hasErrors: boolean
  firstSeenAt: string | null
  lastSeenAt: string | null
  inputTokens: string
  outputTokens: string
  cacheReadTokens: string
  cacheWriteTokens: string
  totalTokens: string
  totalCostMicros: string
  modelCount: number
  topModels: string[]
}

export interface UsageExploreSessionsResult {
  from: string
  to: string
  timezone: string
  filters: UsageExploreFilterEcho
  page: number
  pageSize: number
  totalSessions: number
  totalPages: number
  sort: UsageExploreSort
  rows: UsageExploreSessionRow[]
}

export interface UsageExploreOptionsResult {
  from: string
  to: string
  timezone: string
  filters: UsageExploreFilterEcho
  agents: string[]
  sessionClasses: string[]
  sources: string[]
  channels: string[]
  sessionKinds: string[]
  providers: string[]
  models: Array<{ key: string; label: string }>
  tools: string[]
}

export interface UsageExploreFilterEcho {
  agentId: string | null
  sessionClass: string | null
  source: string | null
  channel: string | null
  sessionKind: string | null
  providerKey: string | null
  modelKey: string | null
  toolName: string | null
  hasErrors: boolean | null
  q: string | null
}

type RangeWindow = {
  from: Date
  to: Date
  fromDay: Date
  toDay: Date
  timezone: string
}

type ResolvedFilters = {
  range: RangeWindow
  filterEcho: UsageExploreFilterEcho
  page: number
  pageSize: number
  sort: UsageExploreSort
}

type SessionDimensionRow = {
  sessionId: string
  agentId: string
  sessionKey: string | null
  source: string | null
  channel: string | null
  sessionKind: string | null
  sessionClass: string | null
  providerKey: string | null
  operationId: string | null
  workOrderId: string | null
  hasErrors: boolean
  firstSeenAt: Date | null
  lastSeenAt: Date | null
}

type DailyUsageRow = {
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

type HourlyUsageRow = {
  sessionId: string
  agentId: string
  modelKey: string
  model: string | null
  hourStart: Date
  inputTokens: bigint
  outputTokens: bigint
  cacheReadTokens: bigint
  cacheWriteTokens: bigint
  totalTokens: bigint
  totalCostMicros: bigint
}

type ToolDailyRow = {
  sessionId: string
  dayStart: Date
  toolName: string
  callCount: bigint
}

type FilteredDailyRow = {
  session: SessionDimensionRow
  usage: DailyUsageRow
}

type FilteredHourlyRow = {
  session: SessionDimensionRow
  usage: HourlyUsageRow
}

function normalizeNowMs(): number {
  return Math.floor(Date.now() / 60_000) * 60_000
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function startOfUtcHour(date: Date): Date {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    0,
    0,
    0
  ))
}

function parseDate(input: string | null | undefined, fallback: Date): Date {
  if (!input) return fallback
  const parsed = new Date(input)
  return Number.isNaN(parsed.getTime()) ? fallback : parsed
}

function normalizeText(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeLabel(input: string | null | undefined): string | null {
  const text = normalizeText(input)
  return text ? text.toLowerCase() : null
}

function normalizeTimezone(input: string | null | undefined): string {
  const requested = normalizeText(input)
  if (!requested) return 'UTC'

  try {
    Intl.DateTimeFormat(undefined, { timeZone: requested }).format(new Date())
    return requested
  } catch {
    return 'UTC'
  }
}

function toBigIntString(value: bigint): string {
  return value.toString()
}

function sumBigInt(values: bigint[]): bigint {
  return values.reduce((acc, next) => acc + next, 0n)
}

function computeCacheEfficiency(cacheRead: bigint, input: bigint): number {
  const denom = cacheRead + input
  if (denom <= 0n) return 0
  return Number((cacheRead * 10_000n) / denom) / 100
}

function getInclusiveDayCount(from: Date, to: Date): number {
  const fromDay = startOfUtcDay(from)
  const toDay = startOfUtcDay(to)
  const diffMs = toDay.getTime() - fromDay.getTime()
  if (!Number.isFinite(diffMs)) return 1
  const days = Math.floor(diffMs / 86_400_000) + 1
  return days > 0 ? days : 1
}

function formatModelLabel(model: string | null, modelKey: string): string {
  const normalizedModel = normalizeText(model)
  if (normalizedModel) return normalizedModel
  const normalizedKey = normalizeText(modelKey)
  return normalizedKey ?? 'unknown'
}

function chunkValues<T>(values: T[], size: number): T[][] {
  if (values.length <= size) return [values]
  const out: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    out.push(values.slice(index, index + size))
  }
  return out
}

async function fetchSessionsByIds(sessionIds: string[]): Promise<SessionDimensionRow[]> {
  if (sessionIds.length === 0) return []

  const chunks = chunkValues(sessionIds, SQLITE_IN_LIMIT)
  const rows = await Promise.all(
    chunks.map((subset) =>
      prisma.sessionUsageAggregate.findMany({
        where: {
          sessionId: { in: subset },
        },
        select: {
          sessionId: true,
          agentId: true,
          sessionKey: true,
          source: true,
          channel: true,
          sessionKind: true,
          sessionClass: true,
          providerKey: true,
          operationId: true,
          workOrderId: true,
          hasErrors: true,
          firstSeenAt: true,
          lastSeenAt: true,
        },
      })
    )
  )

  return rows.flat()
}

async function fetchToolDailyRowsBySessionIds(input: {
  sessionIds: string[]
  fromDay: Date
  toDay: Date
  toolName?: string | null
}): Promise<ToolDailyRow[]> {
  if (input.sessionIds.length === 0) return []

  const chunks = chunkValues(input.sessionIds, SQLITE_IN_LIMIT)
  const rows = await Promise.all(
    chunks.map((subset) =>
      prisma.sessionToolUsageDailyAggregate.findMany({
        where: {
          sessionId: { in: subset },
          dayStart: {
            gte: input.fromDay,
            lte: input.toDay,
          },
          ...(input.toolName ? { toolName: input.toolName } : {}),
        },
        select: {
          sessionId: true,
          dayStart: true,
          toolName: true,
          callCount: true,
        },
      })
    )
  )

  return rows.flat()
}

function resolveFilters(input: UsageExploreFiltersInput): ResolvedFilters {
  const roundedNow = normalizeNowMs()
  const fallbackTo = new Date(roundedNow)
  const fallbackFrom = new Date(roundedNow - DEFAULT_RANGE_DAYS * 86_400_000)

  let from = parseDate(input.from, fallbackFrom)
  let to = parseDate(input.to, fallbackTo)

  if (from.getTime() > to.getTime()) {
    const swap = from
    from = to
    to = swap
  }

  const filterEcho: UsageExploreFilterEcho = {
    agentId: normalizeText(input.agentId),
    sessionClass: normalizeLabel(input.sessionClass),
    source: normalizeLabel(input.source),
    channel: normalizeLabel(input.channel),
    sessionKind: normalizeLabel(input.sessionKind),
    providerKey: normalizeLabel(input.providerKey),
    modelKey: normalizeLabel(input.modelKey),
    toolName: normalizeLabel(input.toolName),
    hasErrors: typeof input.hasErrors === 'boolean' ? input.hasErrors : null,
    q: normalizeText(input.q),
  }

  const safePage = Number.isFinite(input.page) ? Math.max(1, Math.floor(input.page ?? 1)) : 1
  const parsedPageSize = Number.isFinite(input.pageSize) ? Math.floor(input.pageSize ?? DEFAULT_PAGE_SIZE) : DEFAULT_PAGE_SIZE
  const safePageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, parsedPageSize))

  const sort: UsageExploreSort =
    input.sort === 'tokens_desc' || input.sort === 'recent_desc' || input.sort === 'cost_desc'
      ? input.sort
      : 'cost_desc'

  return {
    range: {
      from,
      to,
      fromDay: startOfUtcDay(from),
      toDay: startOfUtcDay(to),
      timezone: normalizeTimezone(input.timezone),
    },
    filterEcho,
    page: safePage,
    pageSize: safePageSize,
    sort,
  }
}

function matchesSessionFilters(session: SessionDimensionRow, filters: UsageExploreFilterEcho): boolean {
  if (filters.agentId && session.agentId !== filters.agentId) return false
  if (filters.sessionClass && normalizeLabel(session.sessionClass) !== filters.sessionClass) return false
  if (filters.source && normalizeLabel(session.source) !== filters.source) return false
  if (filters.channel && normalizeLabel(session.channel) !== filters.channel) return false
  if (filters.sessionKind && normalizeLabel(session.sessionKind) !== filters.sessionKind) return false
  if (filters.providerKey && normalizeLabel(session.providerKey) !== filters.providerKey) return false
  if (filters.hasErrors !== null && session.hasErrors !== filters.hasErrors) return false

  return true
}

function matchesTextQuery(session: SessionDimensionRow, usage: { model: string | null; modelKey: string }, query: string | null): boolean {
  if (!query) return true
  const normalized = query.toLowerCase()

  const haystack = [
    session.sessionId,
    session.agentId,
    session.sessionKey ?? '',
    session.source ?? '',
    session.channel ?? '',
    session.sessionKind ?? '',
    session.sessionClass ?? '',
    session.providerKey ?? '',
    session.operationId ?? '',
    session.workOrderId ?? '',
    usage.model ?? '',
    usage.modelKey,
  ]
    .join(' ')
    .toLowerCase()

  return haystack.includes(normalized)
}

async function loadFilteredDailyRows(input: ResolvedFilters): Promise<FilteredDailyRow[]> {
  const where = {
    dayStart: {
      gte: input.range.fromDay,
      lte: input.range.toDay,
    },
    ...(input.filterEcho.modelKey ? { modelKey: input.filterEcho.modelKey } : {}),
    ...(input.filterEcho.agentId ? { agentId: input.filterEcho.agentId } : {}),
  }

  const usageRows = await prisma.sessionUsageDailyAggregate.findMany({
    where,
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

  if (usageRows.length === 0) return []

  const sessionIds = Array.from(new Set(usageRows.map((row) => row.sessionId)))
  const sessionRows = await fetchSessionsByIds(sessionIds)
  const sessionsById = new Map(sessionRows.map((row) => [row.sessionId, row]))

  let toolSessionIds: Set<string> | null = null
  if (input.filterEcho.toolName) {
    const toolRows = await fetchToolDailyRowsBySessionIds({
      sessionIds,
      fromDay: input.range.fromDay,
      toDay: input.range.toDay,
      toolName: input.filterEcho.toolName,
    })

    toolSessionIds = new Set(toolRows.map((row) => row.sessionId))
  }

  const filtered: FilteredDailyRow[] = []

  for (const usage of usageRows) {
    const session = sessionsById.get(usage.sessionId)
    if (!session) continue
    if (!matchesSessionFilters(session, input.filterEcho)) continue
    if (!matchesTextQuery(session, usage, input.filterEcho.q)) continue
    if (toolSessionIds && !toolSessionIds.has(usage.sessionId)) continue

    filtered.push({
      session,
      usage,
    })
  }

  return filtered
}

async function loadFilteredHourlyRows(input: ResolvedFilters): Promise<FilteredHourlyRow[]> {
  const where = {
    hourStart: {
      gte: startOfUtcHour(input.range.from),
      lte: startOfUtcHour(input.range.to),
    },
    ...(input.filterEcho.modelKey ? { modelKey: input.filterEcho.modelKey } : {}),
    ...(input.filterEcho.agentId ? { agentId: input.filterEcho.agentId } : {}),
  }

  const usageRows = await prisma.sessionUsageHourlyAggregate.findMany({
    where,
    select: {
      sessionId: true,
      agentId: true,
      modelKey: true,
      model: true,
      hourStart: true,
      inputTokens: true,
      outputTokens: true,
      cacheReadTokens: true,
      cacheWriteTokens: true,
      totalTokens: true,
      totalCostMicros: true,
    },
  })

  if (usageRows.length === 0) return []

  const sessionIds = Array.from(new Set(usageRows.map((row) => row.sessionId)))
  const sessionRows = await fetchSessionsByIds(sessionIds)
  const sessionsById = new Map(sessionRows.map((row) => [row.sessionId, row]))

  let toolSessionIds: Set<string> | null = null
  if (input.filterEcho.toolName) {
    const toolRows = await fetchToolDailyRowsBySessionIds({
      sessionIds,
      fromDay: input.range.fromDay,
      toDay: input.range.toDay,
      toolName: input.filterEcho.toolName,
    })

    toolSessionIds = new Set(toolRows.map((row) => row.sessionId))
  }

  const filtered: FilteredHourlyRow[] = []

  for (const usage of usageRows) {
    const session = sessionsById.get(usage.sessionId)
    if (!session) continue
    if (!matchesSessionFilters(session, input.filterEcho)) continue
    if (!matchesTextQuery(session, usage, input.filterEcho.q)) continue
    if (toolSessionIds && !toolSessionIds.has(usage.sessionId)) continue

    filtered.push({
      session,
      usage,
    })
  }

  return filtered
}

function buildDailySeries(input: {
  fromDay: Date
  toDay: Date
  rows: FilteredDailyRow[]
}): UsageExploreSummaryResult['series'] {
  const aggregate = new Map<string, {
    inputTokens: bigint
    outputTokens: bigint
    cacheReadTokens: bigint
    cacheWriteTokens: bigint
    totalTokens: bigint
    totalCostMicros: bigint
  }>()

  for (const row of input.rows) {
    const key = row.usage.dayStart.toISOString()
    const prev = aggregate.get(key) ?? {
      inputTokens: 0n,
      outputTokens: 0n,
      cacheReadTokens: 0n,
      cacheWriteTokens: 0n,
      totalTokens: 0n,
      totalCostMicros: 0n,
    }

    prev.inputTokens += row.usage.inputTokens
    prev.outputTokens += row.usage.outputTokens
    prev.cacheReadTokens += row.usage.cacheReadTokens
    prev.cacheWriteTokens += row.usage.cacheWriteTokens
    prev.totalTokens += row.usage.totalTokens
    prev.totalCostMicros += row.usage.totalCostMicros

    aggregate.set(key, prev)
  }

  const series: UsageExploreSummaryResult['series'] = []
  const dayCursor = new Date(input.fromDay)

  while (dayCursor.getTime() <= input.toDay.getTime()) {
    const key = dayCursor.toISOString()
    const point = aggregate.get(key)

    series.push({
      dayStart: key,
      inputTokens: toBigIntString(point?.inputTokens ?? 0n),
      outputTokens: toBigIntString(point?.outputTokens ?? 0n),
      cacheReadTokens: toBigIntString(point?.cacheReadTokens ?? 0n),
      cacheWriteTokens: toBigIntString(point?.cacheWriteTokens ?? 0n),
      totalTokens: toBigIntString(point?.totalTokens ?? 0n),
      totalCostMicros: toBigIntString(point?.totalCostMicros ?? 0n),
    })

    dayCursor.setUTCDate(dayCursor.getUTCDate() + 1)
  }

  return series
}

function aggregateGroups(rows: FilteredDailyRow[], groupBy: Exclude<UsageExploreBreakdownKey, 'tool'>): UsageExploreBreakdownGroup[] {
  const grouped = new Map<string, {
    key: string
    inputTokens: bigint
    outputTokens: bigint
    cacheReadTokens: bigint
    cacheWriteTokens: bigint
    totalTokens: bigint
    totalCostMicros: bigint
    sessions: Set<string>
  }>()

  for (const row of rows) {
    const groupKey = (() => {
      if (groupBy === 'agent') return normalizeText(row.session.agentId) ?? 'unknown'
      if (groupBy === 'model') return formatModelLabel(row.usage.model, row.usage.modelKey)
      if (groupBy === 'provider') return normalizeText(row.session.providerKey) ?? 'unknown'
      if (groupBy === 'source') return normalizeText(row.session.source) ?? 'unknown'
      return normalizeText(row.session.sessionClass) ?? 'unknown'
    })()

    const entry = grouped.get(groupKey) ?? {
      key: groupKey,
      inputTokens: 0n,
      outputTokens: 0n,
      cacheReadTokens: 0n,
      cacheWriteTokens: 0n,
      totalTokens: 0n,
      totalCostMicros: 0n,
      sessions: new Set<string>(),
    }

    entry.inputTokens += row.usage.inputTokens
    entry.outputTokens += row.usage.outputTokens
    entry.cacheReadTokens += row.usage.cacheReadTokens
    entry.cacheWriteTokens += row.usage.cacheWriteTokens
    entry.totalTokens += row.usage.totalTokens
    entry.totalCostMicros += row.usage.totalCostMicros
    entry.sessions.add(row.usage.sessionId)

    grouped.set(groupKey, entry)
  }

  return Array.from(grouped.values())
    .map((entry) => ({
      key: entry.key,
      inputTokens: toBigIntString(entry.inputTokens),
      outputTokens: toBigIntString(entry.outputTokens),
      cacheReadTokens: toBigIntString(entry.cacheReadTokens),
      cacheWriteTokens: toBigIntString(entry.cacheWriteTokens),
      totalTokens: toBigIntString(entry.totalTokens),
      totalCostMicros: toBigIntString(entry.totalCostMicros),
      sessionCount: entry.sessions.size,
    }))
    .sort((a, b) => {
      const aCost = BigInt(a.totalCostMicros)
      const bCost = BigInt(b.totalCostMicros)
      if (aCost === bCost) return a.key.localeCompare(b.key)
      return aCost > bCost ? -1 : 1
    })
}

function allocateByWeight(value: bigint, weights: bigint[]): bigint[] {
  if (weights.length === 0) return []
  const totalWeight = sumBigInt(weights)
  if (totalWeight <= 0n) return weights.map(() => 0n)

  const shares = weights.map((weight) => (value * weight) / totalWeight)
  let allocated = sumBigInt(shares)
  let remainder = value - allocated

  if (remainder > 0n) {
    let maxIndex = 0
    let maxWeight = weights[0] ?? 0n
    for (let index = 1; index < weights.length; index += 1) {
      if ((weights[index] ?? 0n) > maxWeight) {
        maxWeight = weights[index]
        maxIndex = index
      }
    }

    shares[maxIndex] = (shares[maxIndex] ?? 0n) + remainder
    allocated = sumBigInt(shares)
    remainder = value - allocated

    if (remainder !== 0n) {
      shares[0] = (shares[0] ?? 0n) + remainder
    }
  }

  return shares
}

async function aggregateToolGroups(input: {
  rows: FilteredDailyRow[]
  fromDay: Date
  toDay: Date
}): Promise<UsageExploreBreakdownGroup[]> {
  if (input.rows.length === 0) return []

  const sessionIds = Array.from(new Set(input.rows.map((row) => row.usage.sessionId)))
  const toolRows = await fetchToolDailyRowsBySessionIds({
    sessionIds,
    fromDay: input.fromDay,
    toDay: input.toDay,
  })

  const toolsBySessionDay = new Map<string, Array<{ toolName: string; callCount: bigint }>>()
  for (const tool of toolRows) {
    const key = `${tool.sessionId}::${tool.dayStart.toISOString()}`
    const bucket = toolsBySessionDay.get(key) ?? []
    bucket.push({
      toolName: normalizeText(tool.toolName) ?? 'unknown',
      callCount: tool.callCount,
    })
    toolsBySessionDay.set(key, bucket)
  }

  const grouped = new Map<string, {
    key: string
    inputTokens: bigint
    outputTokens: bigint
    cacheReadTokens: bigint
    cacheWriteTokens: bigint
    totalTokens: bigint
    totalCostMicros: bigint
    toolCallCount: bigint
    sessions: Set<string>
  }>()

  for (const row of input.rows) {
    const dayKey = `${row.usage.sessionId}::${row.usage.dayStart.toISOString()}`
    const tools = toolsBySessionDay.get(dayKey) ?? [{ toolName: 'unknown', callCount: 1n }]

    const weights = tools.map((tool) => tool.callCount)
    const inputShares = allocateByWeight(row.usage.inputTokens, weights)
    const outputShares = allocateByWeight(row.usage.outputTokens, weights)
    const cacheReadShares = allocateByWeight(row.usage.cacheReadTokens, weights)
    const cacheWriteShares = allocateByWeight(row.usage.cacheWriteTokens, weights)
    const totalTokenShares = allocateByWeight(row.usage.totalTokens, weights)
    const costShares = allocateByWeight(row.usage.totalCostMicros, weights)

    for (let index = 0; index < tools.length; index += 1) {
      const tool = tools[index]
      const key = normalizeText(tool?.toolName) ?? 'unknown'
      const entry = grouped.get(key) ?? {
        key,
        inputTokens: 0n,
        outputTokens: 0n,
        cacheReadTokens: 0n,
        cacheWriteTokens: 0n,
        totalTokens: 0n,
        totalCostMicros: 0n,
        toolCallCount: 0n,
        sessions: new Set<string>(),
      }

      entry.inputTokens += inputShares[index] ?? 0n
      entry.outputTokens += outputShares[index] ?? 0n
      entry.cacheReadTokens += cacheReadShares[index] ?? 0n
      entry.cacheWriteTokens += cacheWriteShares[index] ?? 0n
      entry.totalTokens += totalTokenShares[index] ?? 0n
      entry.totalCostMicros += costShares[index] ?? 0n
      entry.toolCallCount += tool?.callCount ?? 0n
      entry.sessions.add(row.usage.sessionId)

      grouped.set(key, entry)
    }
  }

  return Array.from(grouped.values())
    .map((entry) => ({
      key: entry.key,
      inputTokens: toBigIntString(entry.inputTokens),
      outputTokens: toBigIntString(entry.outputTokens),
      cacheReadTokens: toBigIntString(entry.cacheReadTokens),
      cacheWriteTokens: toBigIntString(entry.cacheWriteTokens),
      totalTokens: toBigIntString(entry.totalTokens),
      totalCostMicros: toBigIntString(entry.totalCostMicros),
      sessionCount: entry.sessions.size,
      toolCallCount: toBigIntString(entry.toolCallCount),
    }))
    .sort((a, b) => {
      const aCost = BigInt(a.totalCostMicros)
      const bCost = BigInt(b.totalCostMicros)
      if (aCost === bCost) return a.key.localeCompare(b.key)
      return aCost > bCost ? -1 : 1
    })
}

function weekdayLabel(index: number): string {
  const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return labels[index] ?? `D${index}`
}

function toLocalTimeParts(date: Date, timezone: string): { weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const weekdayPart = parts.find((part) => part.type === 'weekday')?.value ?? 'Sun'
  const hourPart = parts.find((part) => part.type === 'hour')?.value ?? '0'

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }

  const weekday = weekdayMap[weekdayPart] ?? 0
  const hour = Math.max(0, Math.min(23, Number.parseInt(hourPart, 10) || 0))

  return { weekday, hour }
}

function cacheKey(prefix: string, input: ResolvedFilters, extra: string = ''): string {
  return [
    prefix,
    input.range.from.toISOString(),
    input.range.to.toISOString(),
    input.range.timezone,
    input.filterEcho.agentId ?? 'all',
    input.filterEcho.sessionClass ?? 'all',
    input.filterEcho.source ?? 'all',
    input.filterEcho.channel ?? 'all',
    input.filterEcho.sessionKind ?? 'all',
    input.filterEcho.providerKey ?? 'all',
    input.filterEcho.modelKey ?? 'all',
    input.filterEcho.toolName ?? 'all',
    input.filterEcho.hasErrors === null ? 'all' : String(input.filterEcho.hasErrors),
    input.filterEcho.q ?? '',
    `page=${input.page}`,
    `pageSize=${input.pageSize}`,
    `sort=${input.sort}`,
    extra,
  ].join(':')
}

export async function getUsageExploreSummary(input: UsageExploreFiltersInput): Promise<UsageExploreSummaryResult> {
  const resolved = resolveFilters(input)
  const key = cacheKey('usage.explore.summary', resolved)

  const { value } = await getOrLoadWithCache(key, QUERY_TTL_MS, async () => {
    const rows = await loadFilteredDailyRows(resolved)
    const series = buildDailySeries({
      fromDay: resolved.range.fromDay,
      toDay: resolved.range.toDay,
      rows,
    })

    const totalInput = sumBigInt(rows.map((row) => row.usage.inputTokens))
    const totalOutput = sumBigInt(rows.map((row) => row.usage.outputTokens))
    const totalCacheRead = sumBigInt(rows.map((row) => row.usage.cacheReadTokens))
    const totalCacheWrite = sumBigInt(rows.map((row) => row.usage.cacheWriteTokens))
    const totalTokens = sumBigInt(rows.map((row) => row.usage.totalTokens))
    const totalCost = sumBigInt(rows.map((row) => row.usage.totalCostMicros))

    const dayCount = BigInt(getInclusiveDayCount(resolved.range.from, resolved.range.to))
    const sessionCount = new Set(rows.map((row) => row.usage.sessionId)).size

    return {
      from: resolved.range.from.toISOString(),
      to: resolved.range.to.toISOString(),
      timezone: resolved.range.timezone,
      filters: resolved.filterEcho,
      totals: {
        inputTokens: toBigIntString(totalInput),
        outputTokens: toBigIntString(totalOutput),
        cacheReadTokens: toBigIntString(totalCacheRead),
        cacheWriteTokens: toBigIntString(totalCacheWrite),
        totalTokens: toBigIntString(totalTokens),
        totalCostMicros: toBigIntString(totalCost),
        cacheEfficiencyPct: computeCacheEfficiency(totalCacheRead, totalInput),
        sessionCount,
        avgTokensPerDay: toBigIntString(totalTokens / dayCount),
        avgCostMicrosPerDay: toBigIntString(totalCost / dayCount),
      },
      series,
    } satisfies UsageExploreSummaryResult
  })

  return value
}

export async function getUsageExploreBreakdown(input: {
  groupBy: UsageExploreBreakdownKey
} & UsageExploreFiltersInput): Promise<UsageExploreBreakdownResult> {
  const resolved = resolveFilters(input)
  const key = cacheKey('usage.explore.breakdown', resolved, `groupBy=${input.groupBy}`)

  const { value } = await getOrLoadWithCache(key, QUERY_TTL_MS, async () => {
    const rows = await loadFilteredDailyRows(resolved)

    const groups = input.groupBy === 'tool'
      ? await aggregateToolGroups({
        rows,
        fromDay: resolved.range.fromDay,
        toDay: resolved.range.toDay,
      })
      : aggregateGroups(rows, input.groupBy)

    return {
      from: resolved.range.from.toISOString(),
      to: resolved.range.to.toISOString(),
      timezone: resolved.range.timezone,
      filters: resolved.filterEcho,
      groupBy: input.groupBy,
      groups,
    } satisfies UsageExploreBreakdownResult
  })

  return value
}

export async function getUsageExploreActivity(input: UsageExploreFiltersInput): Promise<UsageExploreActivityResult> {
  const resolved = resolveFilters(input)
  const key = cacheKey('usage.explore.activity', resolved)

  const { value } = await getOrLoadWithCache(key, QUERY_TTL_MS, async () => {
    const rows = await loadFilteredHourlyRows(resolved)

    const weekdayBuckets = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      label: weekdayLabel(weekday),
      totalTokens: 0n,
      totalCostMicros: 0n,
    }))

    const hourBuckets = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      totalTokens: 0n,
      totalCostMicros: 0n,
    }))

    for (const row of rows) {
      const local = toLocalTimeParts(row.usage.hourStart, resolved.range.timezone)
      weekdayBuckets[local.weekday]!.totalTokens += row.usage.totalTokens
      weekdayBuckets[local.weekday]!.totalCostMicros += row.usage.totalCostMicros
      hourBuckets[local.hour]!.totalTokens += row.usage.totalTokens
      hourBuckets[local.hour]!.totalCostMicros += row.usage.totalCostMicros
    }

    const totalTokens = sumBigInt(rows.map((row) => row.usage.totalTokens))
    const totalCostMicros = sumBigInt(rows.map((row) => row.usage.totalCostMicros))

    return {
      from: resolved.range.from.toISOString(),
      to: resolved.range.to.toISOString(),
      timezone: resolved.range.timezone,
      filters: resolved.filterEcho,
      totals: {
        totalTokens: toBigIntString(totalTokens),
        totalCostMicros: toBigIntString(totalCostMicros),
      },
      weekdays: weekdayBuckets.map((bucket) => ({
        weekday: bucket.weekday,
        label: bucket.label,
        totalTokens: toBigIntString(bucket.totalTokens),
        totalCostMicros: toBigIntString(bucket.totalCostMicros),
      })),
      hours: hourBuckets.map((bucket) => ({
        hour: bucket.hour,
        totalTokens: toBigIntString(bucket.totalTokens),
        totalCostMicros: toBigIntString(bucket.totalCostMicros),
      })),
    } satisfies UsageExploreActivityResult
  })

  return value
}

export async function getUsageExploreSessions(input: UsageExploreFiltersInput): Promise<UsageExploreSessionsResult> {
  const resolved = resolveFilters(input)
  const key = cacheKey('usage.explore.sessions', resolved)

  const { value } = await getOrLoadWithCache(key, QUERY_TTL_MS, async () => {
    const rows = await loadFilteredDailyRows(resolved)

    const bySession = new Map<string, {
      session: SessionDimensionRow
      inputTokens: bigint
      outputTokens: bigint
      cacheReadTokens: bigint
      cacheWriteTokens: bigint
      totalTokens: bigint
      totalCostMicros: bigint
      modelKeys: Set<string>
      modelLabels: Set<string>
    }>()

    for (const row of rows) {
      const bucket = bySession.get(row.usage.sessionId) ?? {
        session: row.session,
        inputTokens: 0n,
        outputTokens: 0n,
        cacheReadTokens: 0n,
        cacheWriteTokens: 0n,
        totalTokens: 0n,
        totalCostMicros: 0n,
        modelKeys: new Set<string>(),
        modelLabels: new Set<string>(),
      }

      bucket.inputTokens += row.usage.inputTokens
      bucket.outputTokens += row.usage.outputTokens
      bucket.cacheReadTokens += row.usage.cacheReadTokens
      bucket.cacheWriteTokens += row.usage.cacheWriteTokens
      bucket.totalTokens += row.usage.totalTokens
      bucket.totalCostMicros += row.usage.totalCostMicros
      bucket.modelKeys.add(row.usage.modelKey)
      bucket.modelLabels.add(formatModelLabel(row.usage.model, row.usage.modelKey))

      bySession.set(row.usage.sessionId, bucket)
    }

    const sorted = Array.from(bySession.entries())
      .sort(([, a], [, b]) => {
        if (resolved.sort === 'tokens_desc') {
          if (a.totalTokens === b.totalTokens) return 0
          return a.totalTokens > b.totalTokens ? -1 : 1
        }

        if (resolved.sort === 'recent_desc') {
          const aSeen = a.session.lastSeenAt?.getTime() ?? 0
          const bSeen = b.session.lastSeenAt?.getTime() ?? 0
          if (aSeen === bSeen) return 0
          return aSeen > bSeen ? -1 : 1
        }

        if (a.totalCostMicros === b.totalCostMicros) return 0
        return a.totalCostMicros > b.totalCostMicros ? -1 : 1
      })

    const totalSessions = sorted.length
    const totalPages = Math.max(1, Math.ceil(totalSessions / resolved.pageSize))
    const page = Math.min(resolved.page, totalPages)
    const startIndex = (page - 1) * resolved.pageSize
    const paged = sorted.slice(startIndex, startIndex + resolved.pageSize)

    const sessionRows: UsageExploreSessionRow[] = paged.map(([sessionId, entry]) => ({
      sessionId,
      agentId: entry.session.agentId,
      sessionKey: entry.session.sessionKey,
      source: entry.session.source,
      channel: entry.session.channel,
      sessionKind: entry.session.sessionKind,
      sessionClass: entry.session.sessionClass,
      providerKey: entry.session.providerKey,
      operationId: entry.session.operationId,
      workOrderId: entry.session.workOrderId,
      hasErrors: entry.session.hasErrors,
      firstSeenAt: entry.session.firstSeenAt?.toISOString() ?? null,
      lastSeenAt: entry.session.lastSeenAt?.toISOString() ?? null,
      inputTokens: toBigIntString(entry.inputTokens),
      outputTokens: toBigIntString(entry.outputTokens),
      cacheReadTokens: toBigIntString(entry.cacheReadTokens),
      cacheWriteTokens: toBigIntString(entry.cacheWriteTokens),
      totalTokens: toBigIntString(entry.totalTokens),
      totalCostMicros: toBigIntString(entry.totalCostMicros),
      modelCount: entry.modelKeys.size,
      topModels: Array.from(entry.modelLabels).slice(0, 5),
    }))

    return {
      from: resolved.range.from.toISOString(),
      to: resolved.range.to.toISOString(),
      timezone: resolved.range.timezone,
      filters: resolved.filterEcho,
      page,
      pageSize: resolved.pageSize,
      totalSessions,
      totalPages,
      sort: resolved.sort,
      rows: sessionRows,
    } satisfies UsageExploreSessionsResult
  })

  return value
}

export async function getUsageExploreOptions(input: UsageExploreFiltersInput): Promise<UsageExploreOptionsResult> {
  const resolved = resolveFilters(input)
  const key = cacheKey('usage.explore.options', resolved)

  const { value } = await getOrLoadWithCache(key, QUERY_TTL_MS, async () => {
    const rows = await loadFilteredDailyRows(resolved)

    const agents = new Set<string>()
    const sessionClasses = new Set<string>()
    const sources = new Set<string>()
    const channels = new Set<string>()
    const sessionKinds = new Set<string>()
    const providers = new Set<string>()
    const models = new Map<string, string>()

    for (const row of rows) {
      agents.add(row.session.agentId)
      if (row.session.sessionClass) sessionClasses.add(row.session.sessionClass)
      if (row.session.source) sources.add(row.session.source)
      if (row.session.channel) channels.add(row.session.channel)
      if (row.session.sessionKind) sessionKinds.add(row.session.sessionKind)
      if (row.session.providerKey) providers.add(row.session.providerKey)
      models.set(row.usage.modelKey, formatModelLabel(row.usage.model, row.usage.modelKey))
    }

    const sessionIds = Array.from(new Set(rows.map((row) => row.usage.sessionId)))
    const toolRows = await fetchToolDailyRowsBySessionIds({
      sessionIds,
      fromDay: resolved.range.fromDay,
      toDay: resolved.range.toDay,
    })

    const tools = Array.from(new Set(toolRows.map((row) => row.toolName)))

    return {
      from: resolved.range.from.toISOString(),
      to: resolved.range.to.toISOString(),
      timezone: resolved.range.timezone,
      filters: resolved.filterEcho,
      agents: Array.from(agents).sort((a, b) => a.localeCompare(b)),
      sessionClasses: Array.from(sessionClasses).sort((a, b) => a.localeCompare(b)),
      sources: Array.from(sources).sort((a, b) => a.localeCompare(b)),
      channels: Array.from(channels).sort((a, b) => a.localeCompare(b)),
      sessionKinds: Array.from(sessionKinds).sort((a, b) => a.localeCompare(b)),
      providers: Array.from(providers).sort((a, b) => a.localeCompare(b)),
      models: Array.from(models.entries())
        .map(([key, label]) => ({ key, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      tools: tools.sort((a, b) => a.localeCompare(b)),
    } satisfies UsageExploreOptionsResult
  })

  return value
}

export function parseUsageExploreFiltersFromSearchParams(searchParams: URLSearchParams): UsageExploreFiltersInput {
  const parseBoolean = (value: string | null): boolean | null => {
    if (!value) return null
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1') return true
    if (normalized === 'false' || normalized === '0') return false
    return null
  }

  const parseNumber = (value: string | null): number | null => {
    if (!value) return null
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : null
  }

  const sort = normalizeText(searchParams.get('sort')) as UsageExploreSort | null

  return {
    from: searchParams.get('from'),
    to: searchParams.get('to'),
    timezone: searchParams.get('timezone'),
    agentId: searchParams.get('agentId'),
    sessionClass: searchParams.get('sessionClass'),
    source: searchParams.get('source'),
    channel: searchParams.get('channel'),
    sessionKind: searchParams.get('sessionKind'),
    providerKey: searchParams.get('providerKey'),
    modelKey: searchParams.get('modelKey'),
    toolName: searchParams.get('toolName'),
    hasErrors: parseBoolean(searchParams.get('hasErrors')),
    q: searchParams.get('q'),
    page: parseNumber(searchParams.get('page')),
    pageSize: parseNumber(searchParams.get('pageSize')),
    sort,
  }
}
