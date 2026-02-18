import { describe, expect, it } from 'vitest'
import { normalizeCronExpressionToFiveFields } from '@/lib/cron/expression'

describe('cron expression normalization', () => {
  it('passes through valid 5-field expressions', () => {
    expect(normalizeCronExpressionToFiveFields('0 * * * *')).toBe('0 * * * *')
  })

  it('accepts 6-field expressions by dropping the seconds field', () => {
    expect(normalizeCronExpressionToFiveFields('0 0 * * * *')).toBe('0 * * * *')
    expect(normalizeCronExpressionToFiveFields('15 30 9 * * 1')).toBe('30 9 * * 1')
  })

  it('returns null for unsupported field counts', () => {
    expect(normalizeCronExpressionToFiveFields('* * * *')).toBeNull()
    expect(normalizeCronExpressionToFiveFields('* * * * * * *')).toBeNull()
  })
})
