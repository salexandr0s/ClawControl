import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invalidateAsyncCache } from '@/lib/perf/async-cache'

const mockDailyFindMany = vi.fn()
const mockHourlyFindMany = vi.fn()
const mockSessionFindMany = vi.fn()
const mockToolDailyFindMany = vi.fn()
const mockResolveUsageParityScope = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    sessionUsageDailyAggregate: {
      findMany: mockDailyFindMany,
    },
    sessionUsageHourlyAggregate: {
      findMany: mockHourlyFindMany,
    },
    sessionUsageAggregate: {
      findMany: mockSessionFindMany,
    },
    sessionToolUsageDailyAggregate: {
      findMany: mockToolDailyFindMany,
    },
  },
}))

vi.mock('@/lib/openclaw/usage-parity-scope', () => ({
  resolveUsageParityScope: mockResolveUsageParityScope,
}))

const dailyRows = [
  {
    sessionId: 's1',
    agentId: 'agent-a',
    modelKey: 'gpt-5.2',
    model: 'gpt-5.2',
    dayStart: new Date('2026-02-05T00:00:00.000Z'),
    inputTokens: 100n,
    outputTokens: 50n,
    cacheReadTokens: 20n,
    cacheWriteTokens: 10n,
    totalTokens: 180n,
    totalCostMicros: 1500n,
  },
  {
    sessionId: 's1',
    agentId: 'agent-a',
    modelKey: 'gpt-5.2',
    model: 'gpt-5.2',
    dayStart: new Date('2026-02-06T00:00:00.000Z'),
    inputTokens: 60n,
    outputTokens: 30n,
    cacheReadTokens: 10n,
    cacheWriteTokens: 5n,
    totalTokens: 105n,
    totalCostMicros: 900n,
  },
  {
    sessionId: 's2',
    agentId: 'agent-b',
    modelKey: 'claude-opus-4-5',
    model: 'claude-opus-4-5',
    dayStart: new Date('2026-02-05T00:00:00.000Z'),
    inputTokens: 200n,
    outputTokens: 80n,
    cacheReadTokens: 0n,
    cacheWriteTokens: 0n,
    totalTokens: 280n,
    totalCostMicros: 2100n,
  },
]

const hourlyRows = [
  {
    sessionId: 's1',
    agentId: 'agent-a',
    modelKey: 'gpt-5.2',
    model: 'gpt-5.2',
    hourStart: new Date('2026-02-05T10:00:00.000Z'),
    inputTokens: 100n,
    outputTokens: 50n,
    cacheReadTokens: 20n,
    cacheWriteTokens: 10n,
    totalTokens: 180n,
    totalCostMicros: 1500n,
  },
  {
    sessionId: 's2',
    agentId: 'agent-b',
    modelKey: 'claude-opus-4-5',
    model: 'claude-opus-4-5',
    hourStart: new Date('2026-02-05T15:00:00.000Z'),
    inputTokens: 200n,
    outputTokens: 80n,
    cacheReadTokens: 0n,
    cacheWriteTokens: 0n,
    totalTokens: 280n,
    totalCostMicros: 2100n,
  },
]

const sessionRows = [
  {
    sessionId: 's1',
    agentId: 'agent-a',
    sessionKey: 'telegram:main:chat',
    source: 'telegram',
    channel: 'telegram',
    sessionKind: 'chat',
    sessionClass: 'interactive',
    providerKey: 'openai',
    operationId: null,
    workOrderId: null,
    hasErrors: false,
    firstSeenAt: new Date('2026-02-05T10:00:00.000Z'),
    lastSeenAt: new Date('2026-02-06T10:00:00.000Z'),
  },
  {
    sessionId: 's2',
    agentId: 'agent-b',
    sessionKey: 'agent:main:cron:heartbeat',
    source: 'overlay',
    channel: 'cron',
    sessionKind: 'cron',
    sessionClass: 'background_cron',
    providerKey: 'anthropic',
    operationId: 'op_1234567890',
    workOrderId: 'wo_1234567890',
    hasErrors: true,
    firstSeenAt: new Date('2026-02-05T15:00:00.000Z'),
    lastSeenAt: new Date('2026-02-05T15:30:00.000Z'),
  },
]

const toolDailyRows = [
  {
    sessionId: 's1',
    dayStart: new Date('2026-02-05T00:00:00.000Z'),
    toolName: 'read',
    callCount: 3n,
  },
  {
    sessionId: 's1',
    dayStart: new Date('2026-02-05T00:00:00.000Z'),
    toolName: 'write',
    callCount: 1n,
  },
  {
    sessionId: 's2',
    dayStart: new Date('2026-02-05T00:00:00.000Z'),
    toolName: 'exec',
    callCount: 2n,
  },
]

describe('usage-explore-query', () => {
  beforeEach(() => {
    invalidateAsyncCache()
    vi.resetModules()

    mockDailyFindMany.mockReset()
    mockHourlyFindMany.mockReset()
    mockSessionFindMany.mockReset()
    mockToolDailyFindMany.mockReset()
    mockResolveUsageParityScope.mockReset()

    mockResolveUsageParityScope.mockResolvedValue({
      from: '2026-02-05T00:00:00.000Z',
      to: '2026-02-06T23:59:59.999Z',
      sessionLimit: 1000,
      sessionIdsSampled: ['s1', 's2'],
      sampledCount: 2,
      sessionsInRangeTotal: 2,
      priorityPaths: [],
      missingCoverageCount: 0,
    })

    mockDailyFindMany.mockImplementation(async ({ where }: {
      where: {
        dayStart: { gte: Date; lte: Date }
        modelKey?: string
        agentId?: string
        sessionId?: { in: string[] }
      }
    }) => {
      const sessionIds = where.sessionId ? new Set(where.sessionId.in) : null
      return dailyRows.filter((row) =>
        row.dayStart >= where.dayStart.gte
        && row.dayStart <= where.dayStart.lte
        && (!where.modelKey || row.modelKey === where.modelKey)
        && (!where.agentId || row.agentId === where.agentId)
        && (!sessionIds || sessionIds.has(row.sessionId))
      )
    })

    mockHourlyFindMany.mockImplementation(async ({ where }: {
      where: {
        hourStart: { gte: Date; lte: Date }
        modelKey?: string
        agentId?: string
        sessionId?: { in: string[] }
      }
    }) => {
      const sessionIds = where.sessionId ? new Set(where.sessionId.in) : null
      return hourlyRows.filter((row) =>
        row.hourStart >= where.hourStart.gte
        && row.hourStart <= where.hourStart.lte
        && (!where.modelKey || row.modelKey === where.modelKey)
        && (!where.agentId || row.agentId === where.agentId)
        && (!sessionIds || sessionIds.has(row.sessionId))
      )
    })

    mockSessionFindMany.mockImplementation(async ({ where }: { where: { sessionId: { in: string[] } } }) => {
      const ids = new Set(where.sessionId.in)
      return sessionRows.filter((row) => ids.has(row.sessionId))
    })

    mockToolDailyFindMany.mockImplementation(async ({ where }: {
      where: {
        sessionId: { in: string[] }
        dayStart: { gte: Date; lte: Date }
        toolName?: string
      }
    }) => {
      const ids = new Set(where.sessionId.in)
      return toolDailyRows.filter((row) =>
        ids.has(row.sessionId)
        && row.dayStart >= where.dayStart.gte
        && row.dayStart <= where.dayStart.lte
        && (!where.toolName || row.toolName === where.toolName)
      )
    })
  })

  it('keeps summary totals aligned with series and all breakdown groups', async () => {
    const query = await import('@/lib/openclaw/usage-explore-query')

    const summary = await query.getUsageExploreSummary({
      from: '2026-02-05T00:00:00.000Z',
      to: '2026-02-06T23:59:59.999Z',
      timezone: 'UTC',
    })

    const seriesCost = summary.series
      .map((point) => BigInt(point.totalCostMicros))
      .reduce((sum, value) => sum + value, 0n)

    expect(seriesCost.toString()).toBe(summary.totals.totalCostMicros)

    for (const groupBy of ['agent', 'model', 'provider', 'source', 'sessionClass', 'tool'] as const) {
      const breakdown = await query.getUsageExploreBreakdown({
        groupBy,
        from: '2026-02-05T00:00:00.000Z',
        to: '2026-02-06T23:59:59.999Z',
        timezone: 'UTC',
      })

      const breakdownCost = breakdown.groups
        .map((group) => BigInt(group.totalCostMicros))
        .reduce((sum, value) => sum + value, 0n)

      expect(breakdownCost.toString()).toBe(summary.totals.totalCostMicros)
    }

    // Window is inclusive (2 days), so zero-filled day series is preserved.
    expect(summary.series).toHaveLength(2)
  })

  it('applies filters consistently across summary/sessions/breakdowns', async () => {
    const query = await import('@/lib/openclaw/usage-explore-query')

    const summary = await query.getUsageExploreSummary({
      from: '2026-02-05T00:00:00.000Z',
      to: '2026-02-06T23:59:59.999Z',
      timezone: 'UTC',
      agentId: 'agent-a',
      sessionClass: 'interactive',
      providerKey: 'openai',
      toolName: 'read',
    })

    expect(summary.totals.totalCostMicros).toBe('2400')
    expect(summary.totals.sessionCount).toBe(1)

    const sessions = await query.getUsageExploreSessions({
      from: '2026-02-05T00:00:00.000Z',
      to: '2026-02-06T23:59:59.999Z',
      timezone: 'UTC',
      agentId: 'agent-a',
      sessionClass: 'interactive',
      providerKey: 'openai',
      toolName: 'read',
    })

    expect(sessions.totalSessions).toBe(1)
    expect(sessions.rows[0]?.agentId).toBe('agent-a')

    const breakdown = await query.getUsageExploreBreakdown({
      groupBy: 'agent',
      from: '2026-02-05T00:00:00.000Z',
      to: '2026-02-06T23:59:59.999Z',
      timezone: 'UTC',
      agentId: 'agent-a',
      sessionClass: 'interactive',
      providerKey: 'openai',
      toolName: 'read',
    })

    expect(breakdown.groups).toHaveLength(1)
    expect(breakdown.groups[0]?.key).toBe('agent-a')
    expect(breakdown.groups[0]?.totalCostMicros).toBe('2400')
  })

  it('builds day-of-week and hour activity from hourly aggregates', async () => {
    const query = await import('@/lib/openclaw/usage-explore-query')

    const activity = await query.getUsageExploreActivity({
      from: '2026-02-05T00:00:00.000Z',
      to: '2026-02-05T23:59:59.999Z',
      timezone: 'UTC',
    })

    const hour10 = activity.hours.find((bucket) => bucket.hour === 10)
    const hour15 = activity.hours.find((bucket) => bucket.hour === 15)

    expect(hour10?.totalTokens).toBe('180')
    expect(hour15?.totalTokens).toBe('280')
    expect(activity.totals.totalCostMicros).toBe('3600')
  })

  it('applies parity session sampling and exposes summary metadata', async () => {
    const query = await import('@/lib/openclaw/usage-explore-query')

    mockResolveUsageParityScope.mockResolvedValue({
      from: '2026-02-05T00:00:00.000Z',
      to: '2026-02-06T23:59:59.999Z',
      sessionLimit: 1000,
      sessionIdsSampled: ['s1'],
      sampledCount: 1,
      sessionsInRangeTotal: 2,
      priorityPaths: ['missing-session.jsonl'],
      missingCoverageCount: 1,
    })

    const summary = await query.getUsageExploreSummary({
      scope: 'parity',
      from: '2026-02-05T00:00:00.000Z',
      to: '2026-02-06T23:59:59.999Z',
      timezone: 'UTC',
    })

    expect(summary.meta.scope).toBe('parity')
    expect(summary.meta.sessionSampleCount).toBe(1)
    expect(summary.meta.sessionsInRangeTotal).toBe(2)
    expect(summary.meta.missingCoverageCount).toBe(1)
    expect(summary.totals.totalCostMicros).toBe('2400')
    expect(summary.totals.sessionCount).toBe(1)

    const sessions = await query.getUsageExploreSessions({
      scope: 'parity',
      from: '2026-02-05T00:00:00.000Z',
      to: '2026-02-06T23:59:59.999Z',
      timezone: 'UTC',
    })

    expect(sessions.totalSessions).toBe(1)
    expect(sessions.rows[0]?.sessionId).toBe('s1')
  })

  it('keeps all-ingested mode behavior and bypasses parity sampling', async () => {
    const query = await import('@/lib/openclaw/usage-explore-query')

    mockResolveUsageParityScope.mockClear()

    const summary = await query.getUsageExploreSummary({
      scope: 'all',
      from: '2026-02-05T00:00:00.000Z',
      to: '2026-02-06T23:59:59.999Z',
      timezone: 'UTC',
    })

    expect(summary.meta.scope).toBe('all')
    expect(summary.meta.sessionSampleCount).toBeNull()
    expect(summary.totals.totalCostMicros).toBe('4500')
    expect(summary.totals.sessionCount).toBe(2)
    expect(mockResolveUsageParityScope).not.toHaveBeenCalled()
  })

  it('chunks parity session id filters to stay under sqlite in limits', async () => {
    const query = await import('@/lib/openclaw/usage-explore-query')

    const sampledIds = Array.from({ length: 1001 }, (_, index) => `sample-${index}`)
    sampledIds[0] = 's1'
    sampledIds[1] = 's2'

    mockResolveUsageParityScope.mockResolvedValueOnce({
      from: '2026-02-05T00:00:00.000Z',
      to: '2026-02-06T23:59:59.999Z',
      sessionLimit: 1001,
      sessionIdsSampled: sampledIds,
      sampledCount: sampledIds.length,
      sessionsInRangeTotal: sampledIds.length,
      priorityPaths: [],
      missingCoverageCount: 0,
    })

    mockDailyFindMany.mockClear()

    const summary = await query.getUsageExploreSummary({
      scope: 'parity',
      from: '2026-02-05T00:00:00.000Z',
      to: '2026-02-06T23:59:59.999Z',
      timezone: 'UTC',
    })

    expect(summary.totals.totalCostMicros).toBe('4500')
    expect(mockDailyFindMany).toHaveBeenCalledTimes(2)

    const inClauseSizes = mockDailyFindMany.mock.calls.map((call) => {
      const where = call?.[0]?.where as { sessionId?: { in: string[] } }
      return where.sessionId?.in.length ?? 0
    })

    expect(inClauseSizes).toEqual([900, 101])
  })
})
