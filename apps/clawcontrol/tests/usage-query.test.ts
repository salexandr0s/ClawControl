import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invalidateAsyncCache } from '@/lib/perf/async-cache'

const mockFindMany = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    sessionUsageDailyAggregate: {
      findMany: mockFindMany,
    },
  },
}))

const fixtureRows = [
  {
    sessionId: 's1',
    agentId: 'agent-alpha',
    modelKey: 'm-one',
    model: 'm-one',
    dayStart: new Date('2026-02-05T00:00:00.000Z'),
    inputTokens: 10n,
    outputTokens: 5n,
    cacheReadTokens: 2n,
    cacheWriteTokens: 1n,
    totalTokens: 18n,
    totalCostMicros: 400n,
  },
  {
    sessionId: 's2',
    agentId: 'agent-beta',
    modelKey: 'm-one',
    model: 'm-one',
    dayStart: new Date('2026-02-05T00:00:00.000Z'),
    inputTokens: 7n,
    outputTokens: 3n,
    cacheReadTokens: 1n,
    cacheWriteTokens: 0n,
    totalTokens: 11n,
    totalCostMicros: 300n,
  },
  {
    sessionId: 's1',
    agentId: 'agent-alpha',
    modelKey: 'm-two',
    model: 'm-two',
    dayStart: new Date('2026-02-06T00:00:00.000Z'),
    inputTokens: 6n,
    outputTokens: 4n,
    cacheReadTokens: 0n,
    cacheWriteTokens: 0n,
    totalTokens: 10n,
    totalCostMicros: 250n,
  },
] as const

describe('usage-query', () => {
  beforeEach(() => {
    mockFindMany.mockReset()
    mockFindMany.mockResolvedValue(fixtureRows)
    invalidateAsyncCache()
    vi.resetModules()
  })

  it('builds daily buckets from usage-event dayStart values and keeps total cost exact', async () => {
    const usageQuery = await import('@/lib/openclaw/usage-query')
    const result = await usageQuery.getUsageSummary({
      range: 'daily',
      from: '2026-02-05T00:00:00.000Z',
      to: '2026-02-06T23:59:59.000Z',
    })

    expect(result.series).toHaveLength(2)
    expect(result.series.map((row) => row.bucketStart)).toEqual([
      '2026-02-05T00:00:00.000Z',
      '2026-02-06T00:00:00.000Z',
    ])

    const seriesCost = result.series
      .map((row) => BigInt(row.totalCostMicros))
      .reduce((sum, value) => sum + value, 0n)

    expect(seriesCost.toString()).toBe(result.totals.totalCostMicros)
    expect(result.totals.totalCostMicros).toBe('950')
  })

  it('keeps model split totals equal to summary totals', async () => {
    const usageQuery = await import('@/lib/openclaw/usage-query')

    const [summary, breakdown] = await Promise.all([
      usageQuery.getUsageSummary({
        range: 'daily',
        from: '2026-02-05T00:00:00.000Z',
        to: '2026-02-06T23:59:59.000Z',
      }),
      usageQuery.getUsageBreakdown({
        groupBy: 'model',
        from: '2026-02-05T00:00:00.000Z',
        to: '2026-02-06T23:59:59.000Z',
      }),
    ])

    const modelSplitCost = breakdown.groups
      .map((group) => BigInt(group.totalCostMicros))
      .reduce((sum, value) => sum + value, 0n)

    expect(modelSplitCost.toString()).toBe(summary.totals.totalCostMicros)
  })

  it('returns both agent and model breakdowns from a single scan', async () => {
    const usageQuery = await import('@/lib/openclaw/usage-query')
    const result = await usageQuery.getUsageBreakdownBoth({
      from: '2026-02-01T00:00:00.000Z',
      to: '2026-02-07T23:59:59.000Z',
    })

    expect(mockFindMany).toHaveBeenCalledTimes(1)
    expect(result.byAgent).toHaveLength(2)
    expect(result.byModel).toHaveLength(2)
    expect(result.byModel[0].key).toBe('m-one')
    expect(result.byModel[0].totalCostMicros).toBe('700')
  })

  it('dedupes concurrent identical breakdown requests', async () => {
    mockFindMany.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return fixtureRows
    })

    const usageQuery = await import('@/lib/openclaw/usage-query')

    const [a, b] = await Promise.all([
      usageQuery.getUsageBreakdown({
        groupBy: 'model',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-02-07T23:59:59.000Z',
      }),
      usageQuery.getUsageBreakdown({
        groupBy: 'model',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-02-07T23:59:59.000Z',
      }),
    ])

    expect(mockFindMany).toHaveBeenCalledTimes(1)
    expect(a.groups).toHaveLength(2)
    expect(b.groups).toHaveLength(2)
  })
})
