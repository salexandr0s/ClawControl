import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invalidateAsyncCache } from '@/lib/perf/async-cache'

const mockFindMany = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    sessionUsageAggregate: {
      findMany: mockFindMany,
    },
  },
}))

describe('usage-query', () => {
  beforeEach(() => {
    mockFindMany.mockReset()
    invalidateAsyncCache()
    vi.resetModules()
  })

  it('returns both agent and model breakdowns from a single scan', async () => {
    const now = new Date('2026-02-07T10:00:00.000Z')
    mockFindMany.mockResolvedValue([
      {
        agentId: 'agent-alpha',
        model: 'm-one',
        inputTokens: 10n,
        outputTokens: 5n,
        cacheReadTokens: 2n,
        cacheWriteTokens: 1n,
        totalTokens: 18n,
        totalCostMicros: 400n,
        lastSeenAt: now,
        sessionId: 's1',
      },
      {
        agentId: 'agent-beta',
        model: 'm-one',
        inputTokens: 7n,
        outputTokens: 3n,
        cacheReadTokens: 1n,
        cacheWriteTokens: 0n,
        totalTokens: 11n,
        totalCostMicros: 300n,
        lastSeenAt: now,
        sessionId: 's2',
      },
    ])

    const usageQuery = await import('@/lib/openclaw/usage-query')
    const result = await usageQuery.getUsageBreakdownBoth({
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-02-07T23:59:59.000Z',
    })

    expect(mockFindMany).toHaveBeenCalledTimes(1)
    expect(result.byAgent).toHaveLength(2)
    expect(result.byModel).toHaveLength(1)
    expect(result.byModel[0].key).toBe('m-one')
    expect(result.byModel[0].totalCostMicros).toBe('700')
  })

  it('dedupes concurrent identical breakdown requests', async () => {
    mockFindMany.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return [
        {
          agentId: 'agent-alpha',
          model: 'm-one',
          inputTokens: 10n,
          outputTokens: 5n,
          cacheReadTokens: 2n,
          cacheWriteTokens: 1n,
          totalTokens: 18n,
          totalCostMicros: 400n,
          lastSeenAt: new Date('2026-02-07T10:00:00.000Z'),
          sessionId: 's1',
        },
      ]
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
    expect(a.groups).toHaveLength(1)
    expect(b.groups).toHaveLength(1)
  })
})
