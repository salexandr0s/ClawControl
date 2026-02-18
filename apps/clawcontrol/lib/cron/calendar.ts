import { normalizeCronExpressionToFiveFields } from './expression'

export type CalendarView = 'day' | 'week' | 'month' | 'year'

export interface CronCalendarSchedule {
  kind: 'at' | 'every' | 'cron'
  atMs?: number
  everyMs?: number
  expr?: string
  tz?: string
}

export interface CronCalendarJob {
  id: string
  enabled: boolean
  schedule: CronCalendarSchedule
  nextRunAtMs?: number | null
  lastRunAtMs?: number | null
}

interface ParsedCronField {
  any: boolean
  values: number[]
}

interface ParsedCronExpr {
  minute: ParsedCronField
  hour: ParsedCronField
  dayOfMonth: ParsedCronField
  month: ParsedCronField
  dayOfWeek: ParsedCronField
}

const cronExprCache = new Map<string, ParsedCronExpr | null>()

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

export function endOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999))
}

export function addUtcDays(date: Date, delta: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + delta))
}

export function addUtcMonths(date: Date, delta: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 1))
}

export function addUtcYears(date: Date, delta: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear() + delta, date.getUTCMonth(), 1))
}

export function startOfUtcWeek(date: Date): Date {
  const dayStart = startOfUtcDay(date)
  const dow = dayStart.getUTCDay()
  return addUtcDays(dayStart, -dow)
}

export function rangeForCalendarView(anchor: Date, view: CalendarView): { start: Date; end: Date } {
  if (view === 'day') {
    const start = startOfUtcDay(anchor)
    return { start, end: endOfUtcDay(start) }
  }

  if (view === 'week') {
    const start = startOfUtcWeek(anchor)
    const end = endOfUtcDay(addUtcDays(start, 6))
    return { start, end }
  }

  if (view === 'month') {
    const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1))
    const end = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0, 23, 59, 59, 999))
    return { start, end }
  }

  const start = new Date(Date.UTC(anchor.getUTCFullYear(), 0, 1))
  const end = new Date(Date.UTC(anchor.getUTCFullYear(), 11, 31, 23, 59, 59, 999))
  return { start, end }
}

export function listUtcDaysInRange(start: Date, end: Date): Date[] {
  const out: Date[] = []
  let cursor = startOfUtcDay(start)
  const endDay = startOfUtcDay(end)

  while (cursor.getTime() <= endDay.getTime()) {
    out.push(cursor)
    cursor = addUtcDays(cursor, 1)
  }

  return out
}

export function estimateRunsForUtcDate(job: CronCalendarJob, date: Date): number {
  if (!job.enabled) return 0

  const dayStartMs = startOfUtcDay(date).getTime()
  const dayEndMs = endOfUtcDay(date).getTime()
  const schedule = job.schedule

  if (schedule.kind === 'at') {
    const atMs =
      typeof schedule.atMs === 'number'
        ? schedule.atMs
        : (job.nextRunAtMs ?? job.lastRunAtMs ?? null)
    if (atMs === null) return 0
    return atMs >= dayStartMs && atMs <= dayEndMs ? 1 : 0
  }

  if (schedule.kind === 'every') {
    if (!schedule.everyMs || schedule.everyMs <= 0) return 0

    const refMs =
      job.nextRunAtMs
      ?? (typeof job.lastRunAtMs === 'number' ? job.lastRunAtMs + schedule.everyMs : Date.now())

    return countEveryRunsInRange(schedule.everyMs, refMs, dayStartMs, dayEndMs)
  }

  const parsed = parseCronExpression(schedule.expr)

  // Fallback for unsupported/invalid expression: keep at least next-run visibility.
  if (!parsed) {
    if (typeof job.nextRunAtMs !== 'number') return 0
    return job.nextRunAtMs >= dayStartMs && job.nextRunAtMs <= dayEndMs ? 1 : 0
  }

  return countCronRunsOnUtcDate(parsed, startOfUtcDay(date))
}

export function estimateRunsInUtcRange(job: CronCalendarJob, start: Date, end: Date): number {
  const days = listUtcDaysInRange(start, end)
  let total = 0
  for (const day of days) total += estimateRunsForUtcDate(job, day)
  return total
}

export function monthGridCells(anchorMonth: Date): Array<{ date: Date | null; inMonth: boolean }> {
  const start = new Date(Date.UTC(anchorMonth.getUTCFullYear(), anchorMonth.getUTCMonth(), 1))
  const end = new Date(Date.UTC(anchorMonth.getUTCFullYear(), anchorMonth.getUTCMonth() + 1, 0))
  const leading = start.getUTCDay()
  const total = end.getUTCDate()

  const cells: Array<{ date: Date | null; inMonth: boolean }> = []

  for (let i = 0; i < leading; i++) {
    cells.push({ date: null, inMonth: false })
  }

  for (let day = 1; day <= total; day++) {
    cells.push({
      date: new Date(Date.UTC(anchorMonth.getUTCFullYear(), anchorMonth.getUTCMonth(), day)),
      inMonth: true,
    })
  }

  while (cells.length % 7 !== 0) {
    cells.push({ date: null, inMonth: false })
  }

  return cells
}

function countEveryRunsInRange(intervalMs: number, refMs: number, startMs: number, endMs: number): number {
  if (intervalMs <= 0) return 0

  const firstMultiplier = Math.ceil((startMs - refMs) / intervalMs)
  const firstRunMs = refMs + firstMultiplier * intervalMs
  if (firstRunMs > endMs) return 0

  return Math.floor((endMs - firstRunMs) / intervalMs) + 1
}

function countCronRunsOnUtcDate(parsed: ParsedCronExpr, utcDayStart: Date): number {
  const month = utcDayStart.getUTCMonth() + 1
  const dayOfMonth = utcDayStart.getUTCDate()
  const dayOfWeek = utcDayStart.getUTCDay()

  if (!matchesField(parsed.month, month)) return 0

  const domMatch = matchesField(parsed.dayOfMonth, dayOfMonth)
  const dowMatch = matchesField(parsed.dayOfWeek, dayOfWeek)

  const dayMatches =
    parsed.dayOfMonth.any && parsed.dayOfWeek.any
      ? true
      : parsed.dayOfMonth.any
        ? dowMatch
        : parsed.dayOfWeek.any
          ? domMatch
          : (domMatch || dowMatch)

  if (!dayMatches) return 0

  return parsed.minute.values.length * parsed.hour.values.length
}

function matchesField(field: ParsedCronField, value: number): boolean {
  if (field.any) return true
  return field.values.includes(value)
}

function parseCronExpression(expr: string | undefined): ParsedCronExpr | null {
  const normalized = normalizeCronExpressionToFiveFields(expr)
  if (!normalized) return null
  if (cronExprCache.has(normalized)) {
    return cronExprCache.get(normalized) ?? null
  }

  const parts = normalized.split(' ')

  const minute = parseCronField(parts[0], 0, 59)
  const hour = parseCronField(parts[1], 0, 23)
  const dayOfMonth = parseCronField(parts[2], 1, 31)
  const month = parseCronField(parts[3], 1, 12)
  const dayOfWeek = parseCronField(parts[4], 0, 7, true)

  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) {
    cronExprCache.set(normalized, null)
    return null
  }

  const parsed: ParsedCronExpr = {
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek,
  }

  cronExprCache.set(normalized, parsed)
  return parsed
}

function parseCronField(rawField: string, min: number, max: number, normalizeDow = false): ParsedCronField | null {
  const field = rawField.trim()
  if (!field) return null

  if (field === '*') {
    return {
      any: true,
      values: rangeValues(min, max, 1),
    }
  }

  const values = new Set<number>()
  const segments = field.split(',').map((s) => s.trim()).filter(Boolean)
  if (segments.length === 0) return null

  for (const segment of segments) {
    const [base, stepRaw] = segment.split('/')
    const step = stepRaw ? Number(stepRaw) : 1
    if (!Number.isInteger(step) || step <= 0) return null

    if (base === '*') {
      for (const value of rangeValues(min, max, step)) {
        values.add(normalizeCronValue(value, normalizeDow))
      }
      continue
    }

    const rangeMatch = base.match(/^(\d+)-(\d+)$/)
    if (rangeMatch) {
      const start = Number(rangeMatch[1])
      const end = Number(rangeMatch[2])
      if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) return null
      if (start < min || end > max) return null

      for (const value of rangeValues(start, end, step)) {
        values.add(normalizeCronValue(value, normalizeDow))
      }
      continue
    }

    const value = Number(base)
    if (!Number.isInteger(value)) return null
    if (value < min || value > max) return null
    values.add(normalizeCronValue(value, normalizeDow))
  }

  const ordered = Array.from(values).sort((a, b) => a - b)
  if (ordered.length === 0) return null

  return {
    any: false,
    values: ordered,
  }
}

function rangeValues(start: number, end: number, step: number): number[] {
  const out: number[] = []
  for (let value = start; value <= end; value += step) out.push(value)
  return out
}

function normalizeCronValue(value: number, normalizeDow: boolean): number {
  if (!normalizeDow) return value
  return value === 7 ? 0 : value
}
