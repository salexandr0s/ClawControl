import { describe, expect, it } from 'vitest'
import {
  addUtcDays,
  estimateRunsForUtcDate,
  estimateRunsInUtcRange,
  rangeForCalendarView,
  startOfUtcDay,
  type CronCalendarJob,
} from '@/lib/cron/calendar'

describe('cron calendar math', () => {
  it('builds expected ranges for all views', () => {
    const anchor = new Date(Date.UTC(2026, 1, 7, 13, 45, 0, 0))

    const day = rangeForCalendarView(anchor, 'day')
    expect(day.start.toISOString()).toBe('2026-02-07T00:00:00.000Z')
    expect(day.end.toISOString()).toBe('2026-02-07T23:59:59.999Z')

    const week = rangeForCalendarView(anchor, 'week')
    expect(week.start.toISOString()).toBe('2026-02-01T00:00:00.000Z')
    expect(week.end.toISOString()).toBe('2026-02-07T23:59:59.999Z')

    const month = rangeForCalendarView(anchor, 'month')
    expect(month.start.toISOString()).toBe('2026-02-01T00:00:00.000Z')
    expect(month.end.toISOString()).toBe('2026-02-28T23:59:59.999Z')

    const year = rangeForCalendarView(anchor, 'year')
    expect(year.start.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(year.end.toISOString()).toBe('2026-12-31T23:59:59.999Z')
  })

  it('counts every-interval schedules from reference point', () => {
    const date = new Date(Date.UTC(2026, 1, 7))

    const job: CronCalendarJob = {
      id: 'every-6h',
      enabled: true,
      schedule: { kind: 'every', everyMs: 6 * 60 * 60 * 1000 },
      nextRunAtMs: Date.UTC(2026, 1, 7, 0, 0, 0, 0),
    }

    expect(estimateRunsForUtcDate(job, date)).toBe(4)
  })

  it('counts one-time schedules only on the matching day', () => {
    const runAt = Date.UTC(2026, 1, 10, 9, 30, 0, 0)
    const job: CronCalendarJob = {
      id: 'one-time',
      enabled: true,
      schedule: { kind: 'at', atMs: runAt },
      nextRunAtMs: runAt,
    }

    expect(estimateRunsForUtcDate(job, new Date(Date.UTC(2026, 1, 10)))).toBe(1)
    expect(estimateRunsForUtcDate(job, new Date(Date.UTC(2026, 1, 11)))).toBe(0)
  })

  it('counts cron expressions for minute/hour combinations', () => {
    const job: CronCalendarJob = {
      id: 'twice-hourly',
      enabled: true,
      schedule: { kind: 'cron', expr: '13,43 * * * *' },
    }

    expect(estimateRunsForUtcDate(job, new Date(Date.UTC(2026, 1, 7)))).toBe(48)
  })

  it('accepts 6-field cron expressions without parse failure', () => {
    const job: CronCalendarJob = {
      id: 'twice-hourly-with-seconds',
      enabled: true,
      schedule: { kind: 'cron', expr: '0 13,43 * * * *' },
    }

    expect(estimateRunsForUtcDate(job, new Date(Date.UTC(2026, 1, 7)))).toBe(48)
  })

  it('uses standard DOM/DOW OR semantics when both fields are restricted', () => {
    const job: CronCalendarJob = {
      id: 'weekday-or-dom',
      enabled: true,
      schedule: { kind: 'cron', expr: '0 9 1 * 1' },
    }

    // Monday 2nd: matches DOW only
    expect(estimateRunsForUtcDate(job, new Date(Date.UTC(2026, 1, 2)))).toBe(1)
    // Sunday 1st: matches DOM only
    expect(estimateRunsForUtcDate(job, new Date(Date.UTC(2026, 1, 1)))).toBe(1)
  })

  it('sums runs across a date range', () => {
    const start = startOfUtcDay(new Date(Date.UTC(2026, 1, 1)))
    const end = startOfUtcDay(addUtcDays(start, 6))

    const job: CronCalendarJob = {
      id: 'daily-noon',
      enabled: true,
      schedule: { kind: 'cron', expr: '0 12 * * *' },
    }

    expect(estimateRunsInUtcRange(job, start, end)).toBe(7)
  })
})
