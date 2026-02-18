import { describe, expect, it } from 'vitest'
import {
  computeUsageAvgPerDay,
  getUtcInclusiveDayCount,
  resolveUsageWindowIso,
} from '@/lib/openclaw/usage-window'

describe('usage-window helpers', () => {
  it('computes inclusive UTC day counts for full-window averages', () => {
    expect(getUtcInclusiveDayCount('2026-02-18T00:00:00.000Z', '2026-02-18T23:59:59.000Z')).toBe(1)
    expect(getUtcInclusiveDayCount('2026-01-26T00:00:00.000Z', '2026-02-18T11:44:00.000Z')).toBe(24)
  })

  it('resolves a fixed N-day UTC window ending at rounded now', () => {
    const nowMs = Date.parse('2026-02-18T11:44:37.120Z')
    const window = resolveUsageWindowIso(24, nowMs)

    expect(window.fromIso).toBe('2026-01-26T00:00:00.000Z')
    expect(window.toIso).toBe('2026-02-18T11:44:00.000Z')
  })

  it('computes avg/day using full window day denominator', () => {
    const avg = computeUsageAvgPerDay({
      totalTokens: '2400',
      totalCostMicros: '240000000',
      dayCount: 24,
    })

    expect(avg).toEqual({
      avgTokens: '100',
      avgCostMicros: '10000000',
    })
  })
})
