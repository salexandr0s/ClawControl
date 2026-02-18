'use client'

import { useState, useRef, useEffect, useCallback, useMemo, type CSSProperties } from 'react'
import { PageHeader, PageSection, EmptyState, Button, SegmentedToggle } from '@clawcontrol/ui'
import { CanonicalTable, type Column } from '@/components/ui/canonical-table'
import { StatusPill } from '@/components/ui/status-pill'
import { InlineLoading, LoadingSpinner } from '@/components/ui/loading-state'
import { ActionConfirmModal } from '@/components/ui/action-confirm-modal'
import { RightDrawer } from '@/components/shell/right-drawer'
import { AvailabilityBadge } from '@/components/availability-badge'
import { getModelShortName } from '@/lib/models'
import {
  addUtcDays,
  estimateRunsForUtcDate,
  estimateRunsInUtcRange,
  startOfUtcDay,
  type CalendarView,
  type CronCalendarJob,
} from '@/lib/cron/calendar'
import { normalizeCronExpressionToFiveFields } from '@/lib/cron/expression'
import { buildCronCreateBody, type CronCreateFormValues } from '@/lib/cron/create-request'
import { apiPost } from '@/lib/http'
import type { CronJobDTO } from '@/lib/data'
import { cn } from '@/lib/utils'
import { timedClientFetch, usePageReadyTiming } from '@/lib/perf/client-timing'
import {
  Clock,
  Plus,
  Play,
  Pause,
  Trash2,
  X,
  RefreshCw,
  Search,
  Save,
  CalendarDays,
  List,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import type { StatusTone } from '@clawcontrol/ui/theme'

type AvailabilityStatus = 'ok' | 'degraded' | 'unavailable'

type OpenClawResponse<T> = {
  status: AvailabilityStatus
  latencyMs: number
  data: T | null
  error: string | null
  timestamp: string
  cached: boolean
  staleAgeMs?: number
}

/**
 * Actual CLI job structure (differs from the UI's CronJobDTO).
 * The OpenClaw CLI currently returns a nested `state` object.
 */
interface CliCronJob {
  id: string
  name: string
  schedule: {
    kind: 'at' | 'every' | 'cron'
    atMs?: number
    everyMs?: number
    expr?: string
    tz?: string
  }
  description?: string
  enabled?: boolean
  sessionTarget?: 'main' | 'isolated'
  wakeMode?: 'now' | 'next-heartbeat'
  agentId?: string
  payload?: {
    kind?: string
    message?: string
    text?: string
    channel?: string
    to?: string
  }
  state?: {
    lastRunAtMs?: number
    nextRunAtMs?: number
    lastStatus?: string
    lastDurationMs?: number
    runCount?: number
  }
  // Legacy flat fields (for backwards compat)
  lastRunAt?: string
  nextRunAt?: string
  lastStatus?: 'success' | 'failed' | 'running'
  runCount?: number
}

interface CronJobRow extends CronJobDTO {
  raw: CliCronJob
  frequencyText: string
  rawScheduleText: string
}

interface CronHealthJob {
  id: string
  name: string
  successRatePct: number
  failureCount: number
  lastFailureReason: string | null
  failureTrend: 'up' | 'flat' | 'down'
  flakinessScore: number
  isFlaky: boolean
}

interface CronHealthReport {
  summary: {
    jobsTotal: number
    jobsWithFailures: number
    flakyJobs: number
    avgSuccessRatePct: number
    totalFailures: number
  }
  jobs: CronHealthJob[]
}

type EditMode = 'every' | 'cron' | 'at'
type InsightsGroup = {
  key: string
  inputTokens: string
  outputTokens: string
  cacheReadTokens: string
  cacheWriteTokens: string
  totalTokens: string
  totalCostMicros: string
  sessionCount: number
}

type AgentModelRow = {
  id: string
  name: string
  displayName: string
  slug: string
  runtimeAgentId: string
  model: string | null
}

type CronCostEstimate = {
  modelId: string | null
  modelLabel: string
  confidence: 'high' | 'medium' | 'low' | 'none'
  estimatedRuns30d: number
  tokensPerRun: number | null
  costMicrosPerRun: number | null
  projectedTokens30d: number | null
  projectedCostMicros30d: number | null
}

type DayBucket = {
  day: Date
  dayKey: string
  totalRuns: number
  jobs: Array<{
    job: CronJobRow
    runs: number
  }>
}

type CalendarMode = 'list' | 'calendar'

type TimelineEvent = {
  key: string
  job: CronJobRow
  runs: number
  minuteOfDay: number
}

type LaidOutTimelineEvent = TimelineEvent & {
  lane: number
  laneCount: number
  clusterId: number
  topPercent: number
  heightPercent: number
}

type TimelineOverflowBadge = {
  key: string
  clusterId: number
  hiddenCount: number
  topPercent: number
  primaryJobId: string
}

type TimelineRenderData = {
  visibleEvents: LaidOutTimelineEvent[]
  overflowBadges: TimelineOverflowBadge[]
}

const TIMELINE_HEIGHT_PX = 1280
const TIMELINE_EVENT_MIN_HEIGHT_PERCENT = 1.2
const TIMELINE_WEEK_MAX_COLUMNS = 3
const TIMELINE_DAY_MAX_COLUMNS = 4

const TIMELINE_EVENT_CHROME: CSSProperties = {
  borderColor: 'rgb(59 130 246 / 0.46)',
  background: 'linear-gradient(135deg, rgb(59 130 246 / 0.26) 0%, rgb(37 99 235 / 0.14) 100%)',
  boxShadow: '0 8px 18px rgb(2 12 24 / 0.42)',
}

const TIMELINE_OVERFLOW_CHROME: CSSProperties = {
  borderColor: 'rgb(71 85 105 / 0.62)',
  background: 'linear-gradient(135deg, rgb(30 41 59 / 0.9) 0%, rgb(15 23 42 / 0.82) 100%)',
  boxShadow: '0 8px 16px rgb(2 6 23 / 0.45)',
}

function formatDurationShort(ms: number): string {
  if (ms % 86400000 === 0) return `${ms / 86400000}d`
  if (ms % 3600000 === 0) return `${ms / 3600000}h`
  if (ms % 60000 === 0) return `${ms / 60000}m`
  if (ms % 1000 === 0) return `${ms / 1000}s`
  return `${ms}ms`
}

function formatDurationLong(ms: number): string {
  if (ms % 86400000 === 0) {
    const days = ms / 86400000
    return `Every ${days} day${days === 1 ? '' : 's'}`
  }
  if (ms % 3600000 === 0) {
    const hours = ms / 3600000
    return `Every ${hours} hour${hours === 1 ? '' : 's'}`
  }
  if (ms % 60000 === 0) {
    const minutes = ms / 60000
    return `Every ${minutes} minute${minutes === 1 ? '' : 's'}`
  }
  if (ms % 1000 === 0) {
    const seconds = ms / 1000
    return `Every ${seconds} second${seconds === 1 ? '' : 's'}`
  }
  return `Every ${ms}ms`
}

function scheduleToFrequencyText(schedule: CliCronJob['schedule']): string {
  if (schedule.kind === 'every' && typeof schedule.everyMs === 'number') {
    return formatDurationLong(schedule.everyMs)
  }
  if (schedule.kind === 'cron') {
    return `Cron expression (${schedule.expr ?? '* * * * *'})`
  }
  if (schedule.kind === 'at') {
    return schedule.atMs ? `One-time at ${new Date(schedule.atMs).toLocaleString()}` : 'One-time schedule'
  }
  return 'Unknown frequency'
}

function scheduleToRawText(schedule: CliCronJob['schedule']): string {
  if (schedule.kind === 'every' && typeof schedule.everyMs === 'number') {
    return `every ${formatDurationShort(schedule.everyMs)}`
  }
  if (schedule.kind === 'cron') {
    return schedule.expr ?? '* * * * *'
  }
  if (schedule.kind === 'at' && typeof schedule.atMs === 'number') {
    return new Date(schedule.atMs).toISOString()
  }
  return schedule.kind
}

function parseCronExpr(expr: string, tz?: string): string {
  const normalized = normalizeCronExpressionToFiveFields(expr)
  if (!normalized) return expr
  const parts = normalized.split(' ')

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts
  const tzSuffix = tz ? ` (${tz.split('/').pop()})` : ''

  // Every N minutes: */N * * * *
  if (
    minute.startsWith('*/') &&
    hour === '*' &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    const interval = parseInt(minute.slice(2), 10)
    return `Every ${interval} min`
  }

  // Specific minutes each hour: M,M * * * * or M * * * *
  if (hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    if (minute.includes(',')) {
      const mins = minute.split(',')
      return `${mins.length}× per hour${tzSuffix}`
    }
    if (minute !== '*') {
      return `Hourly at :${minute.padStart(2, '0')}${tzSuffix}`
    }
  }

  // Daily at specific time: M H * * *
  if (
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*' &&
    hour !== '*' &&
    minute !== '*'
  ) {
    const h = parseInt(hour, 10)
    const m = parseInt(minute, 10)
    const period = h >= 12 ? 'PM' : 'AM'
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
    return `Daily ${h12}:${String(m).padStart(2, '0')} ${period}${tzSuffix}`
  }

  // Weekly: M H * * D
  if (dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const day = days[parseInt(dayOfWeek, 10)] ?? dayOfWeek
    return `Weekly on ${day}${tzSuffix}`
  }

  return expr
}

function formatSchedule(schedule: CliCronJob['schedule']): string {
  switch (schedule.kind) {
    case 'cron':
      return parseCronExpr(schedule.expr ?? '* * * * *', schedule.tz)
    case 'every': {
      if (!schedule.everyMs) return 'Interval unknown'
      const ms = schedule.everyMs
      if (ms < 60000) return `Every ${ms / 1000}s`
      if (ms < 3600000) return `Every ${ms / 60000} min`
      if (ms < 86400000) return `Every ${ms / 3600000}h`
      return `Every ${ms / 86400000}d`
    }
    case 'at':
      return schedule.atMs ? new Date(schedule.atMs).toLocaleString() : 'One-time (TBD)'
    default:
      return 'Unknown'
  }
}

function mapToUiDto(job: CliCronJob): CronJobRow {
  const state = job.state
  const lastRunAtMs = state?.lastRunAtMs
  const nextRunAtMs = state?.nextRunAtMs
  const lastStatus = state?.lastStatus ?? job.lastStatus
  const runCount = state?.runCount ?? job.runCount ?? 0

  const mappedStatus =
    lastStatus === 'ok' ? 'success' : (lastStatus as CronJobDTO['lastStatus'])

  return {
    id: job.id,
    name: job.name,
    schedule: formatSchedule(job.schedule),
    description: job.description ?? '',
    enabled: job.enabled ?? true,
    lastRunAt: lastRunAtMs
      ? new Date(lastRunAtMs)
      : job.lastRunAt
        ? new Date(job.lastRunAt)
        : null,
    nextRunAt: nextRunAtMs
      ? new Date(nextRunAtMs)
      : job.nextRunAt
        ? new Date(job.nextRunAt)
        : null,
    lastStatus: mappedStatus ?? null,
    runCount,
    createdAt: new Date(),
    updatedAt: new Date(),
    raw: job,
    frequencyText: scheduleToFrequencyText(job.schedule),
    rawScheduleText: scheduleToRawText(job.schedule),
  }
}

function toCalendarJob(job: CronJobRow): CronCalendarJob {
  return {
    id: job.id,
    enabled: job.enabled,
    schedule: job.raw.schedule,
    nextRunAtMs: job.raw.state?.nextRunAtMs ?? job.nextRunAt?.getTime() ?? null,
    lastRunAtMs: job.raw.state?.lastRunAtMs ?? job.lastRunAt?.getTime() ?? null,
  }
}

function formatTokenCount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  if (value === 0) return '0'
  return Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value)
}

function formatUsdMicros(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  if (value === 0) return '$0.00'
  return Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 1_000_000)
}

function parseBigIntSafe(value: string): bigint {
  try {
    return BigInt(value)
  } catch {
    return 0n
  }
}

function bigIntToApproxNumber(value: bigint): number {
  const max = BigInt(Number.MAX_SAFE_INTEGER)
  if (value > max) return Number.MAX_SAFE_INTEGER
  if (value < -max) return Number.MIN_SAFE_INTEGER
  return Number(value)
}

function modelShortLabel(modelId: string | null): string {
  if (!modelId) return 'Unknown'
  return getModelShortName(modelId)
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
  )
}

function formatMinuteLabel(day: Date, minuteOfDay: number): string {
  const safeMinute = Math.max(0, Math.min(1439, Math.round(minuteOfDay)))
  const hours = Math.floor(safeMinute / 60)
  const minutes = safeMinute % 60
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    hours,
    minutes
  ).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function endOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
}

function addLocalDays(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta)
}

function addLocalMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1)
}

function addLocalYears(date: Date, delta: number): Date {
  return new Date(date.getFullYear() + delta, date.getMonth(), 1)
}

function startOfLocalWeek(date: Date): Date {
  const day = startOfLocalDay(date)
  return addLocalDays(day, -day.getDay())
}

function rangeForLocalCalendarView(anchor: Date, view: CalendarView): { start: Date; end: Date } {
  if (view === 'day') {
    const start = startOfLocalDay(anchor)
    return { start, end: endOfLocalDay(start) }
  }

  if (view === 'week') {
    const start = startOfLocalWeek(anchor)
    return { start, end: endOfLocalDay(addLocalDays(start, 6)) }
  }

  if (view === 'month') {
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
    const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59, 999)
    return { start, end }
  }

  const start = new Date(anchor.getFullYear(), 0, 1)
  const end = new Date(anchor.getFullYear(), 11, 31, 23, 59, 59, 999)
  return { start, end }
}

function listLocalDaysInRange(start: Date, end: Date): Date[] {
  const out: Date[] = []
  let cursor = startOfLocalDay(start)
  const endDay = startOfLocalDay(end)
  while (cursor.getTime() <= endDay.getTime()) {
    out.push(cursor)
    cursor = addLocalDays(cursor, 1)
  }
  return out
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function localDayToUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
}

function monthGridCellsLocal(anchorMonth: Date): Array<{ date: Date | null; inMonth: boolean }> {
  const start = new Date(anchorMonth.getFullYear(), anchorMonth.getMonth(), 1)
  const end = new Date(anchorMonth.getFullYear(), anchorMonth.getMonth() + 1, 0)
  const leading = start.getDay()
  const total = end.getDate()

  const cells: Array<{ date: Date | null; inMonth: boolean }> = []
  for (let i = 0; i < leading; i++) cells.push({ date: null, inMonth: false })
  for (let day = 1; day <= total; day++) {
    cells.push({
      date: new Date(anchorMonth.getFullYear(), anchorMonth.getMonth(), day),
      inMonth: true,
    })
  }
  while (cells.length % 7 !== 0) cells.push({ date: null, inMonth: false })
  return cells
}

type ParsedUiCronField = {
  any: boolean
  values: number[]
}

type ParsedUiCronExpr = {
  minute: ParsedUiCronField
  hour: ParsedUiCronField
  dayOfMonth: ParsedUiCronField
  month: ParsedUiCronField
  dayOfWeek: ParsedUiCronField
}

function rangeValues(start: number, end: number, step: number): number[] {
  const values: number[] = []
  for (let value = start; value <= end; value += step) values.push(value)
  return values
}

function normalizeCronValue(value: number, normalizeDow: boolean): number {
  if (!normalizeDow) return value
  return value === 7 ? 0 : value
}

function parseUiCronField(rawField: string, min: number, max: number, normalizeDow = false): ParsedUiCronField | null {
  const field = rawField.trim()
  if (!field) return null

  if (field === '*') {
    return { any: true, values: rangeValues(min, max, 1) }
  }

  const values = new Set<number>()
  const segments = field.split(',').map((segment) => segment.trim()).filter(Boolean)
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
  return { any: false, values: ordered }
}

function parseUiCronExpression(expr: string | undefined): ParsedUiCronExpr | null {
  const normalized = normalizeCronExpressionToFiveFields(expr)
  if (!normalized) return null
  const parts = normalized.split(' ')

  const minute = parseUiCronField(parts[0], 0, 59)
  const hour = parseUiCronField(parts[1], 0, 23)
  const dayOfMonth = parseUiCronField(parts[2], 1, 31)
  const month = parseUiCronField(parts[3], 1, 12)
  const dayOfWeek = parseUiCronField(parts[4], 0, 7, true)
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) return null

  return { minute, hour, dayOfMonth, month, dayOfWeek }
}

function matchesCronField(field: ParsedUiCronField, value: number): boolean {
  if (field.any) return true
  return field.values.includes(value)
}

function minuteOfDayForLocalTimestamp(ms: number): number {
  const date = new Date(ms)
  return date.getHours() * 60 + date.getMinutes()
}

function representativeMinuteForLocalDay(job: CronJobRow, day: Date, nowMs: number): number | null {
  const schedule = job.raw.schedule
  const startMs = startOfLocalDay(day).getTime()
  const endMs = endOfLocalDay(day).getTime()
  const isToday = isSameLocalDay(day, new Date(nowMs))

  if (schedule.kind === 'at') {
    const atMs =
      typeof schedule.atMs === 'number'
        ? schedule.atMs
        : (job.raw.state?.nextRunAtMs ?? job.raw.state?.lastRunAtMs ?? null)
    if (atMs === null || atMs < startMs || atMs > endMs) return null
    return minuteOfDayForLocalTimestamp(atMs)
  }

  if (schedule.kind === 'every' && typeof schedule.everyMs === 'number' && schedule.everyMs > 0) {
    const intervalMs = schedule.everyMs
    const refMs =
      job.raw.state?.nextRunAtMs
      ?? (typeof job.raw.state?.lastRunAtMs === 'number' ? job.raw.state.lastRunAtMs + intervalMs : startMs)

    const targetMs = isToday ? Math.max(startMs, nowMs) : startMs
    const multiplier = Math.ceil((targetMs - refMs) / intervalMs)
    let runMs = refMs + multiplier * intervalMs

    if (runMs > endMs) {
      const firstMultiplier = Math.ceil((startMs - refMs) / intervalMs)
      runMs = refMs + firstMultiplier * intervalMs
    }

    if (runMs < startMs || runMs > endMs) return null
    return minuteOfDayForLocalTimestamp(runMs)
  }

  if (schedule.kind === 'cron') {
    const parsed = parseUiCronExpression(schedule.expr)
    if (!parsed) return null

    const month = day.getMonth() + 1
    const dayOfMonth = day.getDate()
    const dayOfWeek = day.getDay()

    if (!matchesCronField(parsed.month, month)) return null

    const domMatch = matchesCronField(parsed.dayOfMonth, dayOfMonth)
    const dowMatch = matchesCronField(parsed.dayOfWeek, dayOfWeek)
    const dayMatches =
      parsed.dayOfMonth.any && parsed.dayOfWeek.any
        ? true
        : parsed.dayOfMonth.any
          ? dowMatch
        : parsed.dayOfWeek.any
            ? domMatch
            : (domMatch || dowMatch)
    if (!dayMatches) return null

    const values: number[] = []
    for (const hour of parsed.hour.values) {
      for (const minute of parsed.minute.values) {
        values.push(hour * 60 + minute)
      }
    }
    if (values.length === 0) return null

    const sorted = values.sort((a, b) => a - b)
    if (!isToday) return sorted[0]

    const nowMinute = new Date(nowMs).getHours() * 60 + new Date(nowMs).getMinutes()
    const upcoming = sorted.find((minute) => minute >= nowMinute)
    return upcoming ?? sorted[sorted.length - 1]
  }

  return null
}

function buildTimelineEventsForLocalDay(day: Date, dayJobs: DayBucket['jobs'], nowMs: number): TimelineEvent[] {
  const events: TimelineEvent[] = []
  const dayKey = localDayKey(day)

  for (const { job, runs } of dayJobs) {
    if (runs <= 0) continue

    let minuteOfDay = representativeMinuteForLocalDay(job, day, nowMs)
    if (minuteOfDay === null && job.nextRunAt && isSameLocalDay(job.nextRunAt, day)) {
      minuteOfDay = job.nextRunAt.getHours() * 60 + job.nextRunAt.getMinutes()
    }
    if (minuteOfDay === null) {
      minuteOfDay = 9 * 60
    }

    events.push({
      key: `${job.id}:${dayKey}:${minuteOfDay}`,
      job,
      runs,
      minuteOfDay,
    })
  }

  return events.sort((a, b) => {
    if (a.minuteOfDay !== b.minuteOfDay) return a.minuteOfDay - b.minuteOfDay
    if (a.runs !== b.runs) return b.runs - a.runs
    return a.job.name.localeCompare(b.job.name)
  })
}

function layoutTimelineEvents(
  events: TimelineEvent[],
  eventDurationMinutes = 12
): LaidOutTimelineEvent[] {
  if (events.length === 0) return []

  type ActiveEvent = { endMinute: number; lane: number; index: number }
  type WorkingEvent = {
    event: TimelineEvent
    startMinute: number
    endMinute: number
    lane: number
    clusterId: number
  }

  const sorted = [...events].sort((a, b) => a.minuteOfDay - b.minuteOfDay || a.job.name.localeCompare(b.job.name))
  const working: WorkingEvent[] = []
  const active: ActiveEvent[] = []
  const clusterLaneCount = new Map<number, number>()
  let clusterId = -1

  for (const event of sorted) {
    const startMinute = Math.max(0, Math.min(1439, event.minuteOfDay))
    const endMinute = Math.min(1440, startMinute + Math.max(15, eventDurationMinutes))

    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i].endMinute <= startMinute) active.splice(i, 1)
    }

    if (active.length === 0) clusterId += 1

    const usedLanes = new Set(active.map((item) => item.lane))
    let lane = 0
    while (usedLanes.has(lane)) lane += 1

    const index = working.push({
      event,
      startMinute,
      endMinute,
      lane,
      clusterId,
    }) - 1

    active.push({ endMinute, lane, index })
    const laneCount = Math.max(clusterLaneCount.get(clusterId) ?? 0, lane + 1)
    clusterLaneCount.set(clusterId, laneCount)
  }

  return working.map((item) => {
    const laneCount = Math.max(1, clusterLaneCount.get(item.clusterId) ?? 1)
    const topPercent = (item.startMinute / 1440) * 100
    const rawHeightPercent = Math.max(
      (item.endMinute - item.startMinute) / 1440 * 100,
      TIMELINE_EVENT_MIN_HEIGHT_PERCENT
    )
    const remainingPercent = Math.max(0, 100 - topPercent)
    const heightPercent = Math.max(0.06, Math.min(rawHeightPercent, remainingPercent))

    return {
      ...item.event,
      lane: item.lane,
      laneCount,
      clusterId: item.clusterId,
      topPercent,
      heightPercent,
    }
  })
}

function timelineEventDurationForCount(eventCount: number): number {
  if (eventCount >= 48) return 8
  if (eventCount >= 32) return 10
  if (eventCount >= 20) return 12
  if (eventCount >= 10) return 14
  return 18
}

function buildTimelineRenderData(events: LaidOutTimelineEvent[], maxColumns: number): TimelineRenderData {
  const visibleEvents: LaidOutTimelineEvent[] = []
  const overflowByCluster = new Map<number, TimelineOverflowBadge>()

  for (const event of events) {
    if (event.lane < maxColumns) {
      visibleEvents.push(event)
      continue
    }

    const existing = overflowByCluster.get(event.clusterId)
    if (existing) {
      existing.hiddenCount += 1
      if (event.topPercent < existing.topPercent) {
        existing.topPercent = event.topPercent
        existing.primaryJobId = event.job.id
      }
      continue
    }

    overflowByCluster.set(event.clusterId, {
      key: `overflow:${event.key}`,
      clusterId: event.clusterId,
      hiddenCount: 1,
      topPercent: event.topPercent,
      primaryJobId: event.job.id,
    })
  }

  const overflowBadges = [...overflowByCluster.values()].sort((a, b) => a.topPercent - b.topPercent)
  return { visibleEvents, overflowBadges }
}

function timelineColumnInsets(
  event: LaidOutTimelineEvent,
  maxColumns: number,
  insetPx: number
): { left: string; right: string; columns: number } {
  const columns = Math.min(Math.max(event.laneCount, 1), maxColumns)
  const safeLane = Math.max(0, Math.min(event.lane, columns - 1))
  const leftPercent = (safeLane / columns) * 100
  const rightPercent = ((columns - safeLane - 1) / columns) * 100
  return {
    left: `calc(${leftPercent}% + ${insetPx}px)`,
    right: `calc(${rightPercent}% + ${insetPx}px)`,
    columns,
  }
}

function buildAgentTokenMap(agents: AgentModelRow[]): Map<string, AgentModelRow> {
  const map = new Map<string, AgentModelRow>()

  for (const agent of agents) {
    const values = [
      agent.id,
      agent.runtimeAgentId,
      agent.slug,
      agent.displayName,
      agent.name,
    ]
      .map((v) => v?.trim().toLowerCase())
      .filter((v): v is string => Boolean(v))

    for (const value of values) {
      map.set(value, agent)
    }
  }

  return map
}

function formatPercent(value: number | null | undefined, digits = 1): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return `${value.toFixed(digits)}%`
}

async function timedFetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
  meta: { page: string; name: string }
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort('timeout'), timeoutMs)
  try {
    return await timedClientFetch(input, {
      ...init,
      signal: controller.signal,
    }, meta)
  } finally {
    clearTimeout(timeout)
  }
}

export function CronClient() {
  const [availability, setAvailability] = useState<OpenClawResponse<unknown> | null>(null)
  const [cronJobs, setCronJobs] = useState<CronJobRow[]>([])
  const [healthReport, setHealthReport] = useState<CronHealthReport | null>(null)
  const [calendarMode, setCalendarMode] = useState<CalendarMode>('list')
  const [calendarView, setCalendarView] = useState<CalendarView>('month')
  const [calendarAnchor, setCalendarAnchor] = useState<Date>(() => startOfLocalDay(new Date()))
  const [searchText, setSearchText] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [agentModels, setAgentModels] = useState<AgentModelRow[]>([])
  const [usageByAgent, setUsageByAgent] = useState<InsightsGroup[]>([])
  const [usageByModel, setUsageByModel] = useState<InsightsGroup[]>([])
  const [defaultModelId, setDefaultModelId] = useState<string | null>(null)
  const [isHealthLoading, setIsHealthLoading] = useState(false)
  const [isUsageLoading, setIsUsageLoading] = useState(false)
  const [isAgentOverlayLoading, setIsAgentOverlayLoading] = useState(false)
  const [isModelInfoLoading, setIsModelInfoLoading] = useState(false)

  usePageReadyTiming('cron', !isLoading)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const selectedJob = selectedId ? cronJobs.find((c) => c.id === selectedId) : undefined

  const healthByJobKey = useMemo(() => {
    const map = new Map<string, CronHealthJob>()
    for (const row of healthReport?.jobs ?? []) {
      if (row.id) map.set(`id:${row.id}`, row)
      if (row.name?.trim()) map.set(`name:${row.name.trim().toLowerCase()}`, row)
    }
    return map
  }, [healthReport?.jobs])

  const healthForJob = useCallback((job: CronJobRow): CronHealthJob | null => {
    const byId = healthByJobKey.get(`id:${job.id}`)
    if (byId) return byId
    return healthByJobKey.get(`name:${job.name.trim().toLowerCase()}`) ?? null
  }, [healthByJobKey])

  const selectedHealth = useMemo(
    () => (selectedJob ? healthForJob(selectedJob) : null),
    [healthForJob, selectedJob]
  )

  const cronColumns = useMemo<Column<CronJobRow>[]>(() => [
    {
      key: 'status',
      header: '',
      width: '24px',
      render: (row) => (
        <span className={cn(
          'w-2 h-2 rounded-full inline-block',
          row.enabled ? 'bg-status-success' : 'bg-fg-3'
        )} />
      ),
    },
    {
      key: 'name',
      header: 'Job',
      width: '220px',
      render: (row) => (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            setSelectedId(row.id)
          }}
          className="text-fg-0 font-medium hover:text-status-info hover:underline underline-offset-2 text-left"
        >
          {row.name}
        </button>
      ),
    },
    {
      key: 'schedule',
      header: 'Schedule',
      width: '170px',
      render: (row) => <span className="text-fg-1">{row.schedule}</span>,
    },
    {
      key: 'healthSuccess',
      header: 'Success',
      width: '80px',
      align: 'right',
      render: (row) => {
        const health = healthForJob(row)
        return <span className="font-mono text-fg-1">{formatPercent(health?.successRatePct)}</span>
      },
    },
    {
      key: 'healthFailures',
      header: 'Fails',
      width: '70px',
      align: 'right',
      render: (row) => {
        const health = healthForJob(row)
        if (!health) return <span className="font-mono text-fg-2">—</span>
        return (
          <span className={cn('font-mono', health.failureCount > 0 ? 'text-status-danger' : 'text-fg-2')}>
            {health.failureCount}
          </span>
        )
      },
    },
    {
      key: 'healthFlaky',
      header: 'Flaky',
      width: '80px',
      align: 'right',
      render: (row) => {
        const health = healthForJob(row)
        if (!health) return <span className="font-mono text-fg-2">—</span>
        return (
          <span className={cn('font-mono', health.isFlaky ? 'text-status-warning' : 'text-fg-2')}>
            {formatPercent(health.flakinessScore * 100, 0)}
          </span>
        )
      },
    },
    {
      key: 'lastStatus',
      header: 'Status',
      width: '90px',
      render: (row) => {
        if (!row.lastStatus) return <span className="text-fg-3">—</span>
        const toneMap: Record<string, StatusTone> = {
          success: 'success',
          failed: 'danger',
          running: 'progress',
        }
        return <StatusPill tone={toneMap[row.lastStatus] ?? 'muted'} label={row.lastStatus} />
      },
    },
    {
      key: 'nextRunAt',
      header: 'Next',
      width: '80px',
      align: 'right',
      render: (row) => (
        <span className="text-fg-2 text-sm">
          {row.nextRunAt ? formatRelativeTime(row.nextRunAt) : '—'}
        </span>
      ),
    },
  ], [healthForJob])
  const userTimeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local',
    []
  )

  const enabledCount = cronJobs.filter((c) => c.enabled).length
  const filteredCronJobs = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    if (!q) return cronJobs

    return cronJobs.filter((job) => {
      const haystack = [
        job.name,
        job.description,
        job.schedule,
        job.frequencyText,
        job.rawScheduleText,
        job.raw.agentId ?? '',
        job.raw.sessionTarget ?? '',
        job.raw.wakeMode ?? '',
        job.raw.payload?.kind ?? '',
        job.raw.payload?.message ?? '',
        job.raw.payload?.text ?? '',
      ]
        .join(' ')
        .toLowerCase()

      return haystack.includes(q)
    })
  }, [cronJobs, searchText])

  const calendarJobs = useMemo(
    () => filteredCronJobs.map((job) => ({ row: job, schedule: toCalendarJob(job) })),
    [filteredCronJobs]
  )

  const calendarRange = useMemo(
    () => rangeForLocalCalendarView(calendarAnchor, calendarView),
    [calendarAnchor, calendarView]
  )

  const dayBuckets = useMemo<DayBucket[]>(() => {
    const days = listLocalDaysInRange(calendarRange.start, calendarRange.end)

    return days.map((day) => {
      const utcDay = localDayToUtcDay(day)
      const jobs = calendarJobs
        .map(({ row, schedule }) => ({
          job: row,
          runs: estimateRunsForUtcDate(schedule, utcDay),
        }))
        .filter((item) => item.runs > 0)
        .sort((a, b) => b.runs - a.runs || a.job.name.localeCompare(b.job.name))

      return {
        day,
        dayKey: localDayKey(day),
        totalRuns: jobs.reduce((sum, item) => sum + item.runs, 0),
        jobs,
      }
    })
  }, [calendarJobs, calendarRange.end, calendarRange.start])

  const dayBucketsByKey = useMemo(() => {
    const out = new Map<string, DayBucket>()
    for (const bucket of dayBuckets) out.set(bucket.dayKey, bucket)
    return out
  }, [dayBuckets])

  const timelineEventsByDayKey = useMemo(() => {
    const out = new Map<string, LaidOutTimelineEvent[]>()
    for (const bucket of dayBuckets) {
      const timelineEvents = buildTimelineEventsForLocalDay(bucket.day, bucket.jobs, nowMs)
      out.set(
        bucket.dayKey,
        layoutTimelineEvents(timelineEvents, timelineEventDurationForCount(timelineEvents.length))
      )
    }
    return out
  }, [dayBuckets, nowMs])

  const yearBuckets = useMemo(() => {
    if (calendarView !== 'year') return []

    const year = calendarAnchor.getFullYear()
    return Array.from({ length: 12 }, (_, monthIndex) => {
      const start = new Date(year, monthIndex, 1)
      const end = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999)
      const monthDays = listLocalDaysInRange(start, end)

      const jobs = calendarJobs
        .map(({ row, schedule }) => ({
          job: row,
          runs: monthDays.reduce(
            (sum, day) => sum + estimateRunsForUtcDate(schedule, localDayToUtcDay(day)),
            0
          ),
        }))
        .filter((item) => item.runs > 0)
        .sort((a, b) => b.runs - a.runs || a.job.name.localeCompare(b.job.name))

      return {
        monthIndex,
        monthLabel: start.toLocaleDateString(undefined, { month: 'short' }),
        start,
        totalRuns: jobs.reduce((sum, item) => sum + item.runs, 0),
        jobs,
      }
    })
  }, [calendarAnchor, calendarJobs, calendarView])

  const agentByToken = useMemo(() => buildAgentTokenMap(agentModels), [agentModels])

  const usageByAgentMap = useMemo(() => {
    const out = new Map<string, InsightsGroup>()
    for (const row of usageByAgent) out.set(row.key.trim().toLowerCase(), row)
    return out
  }, [usageByAgent])

  const usageByModelMap = useMemo(() => {
    const out = new Map<string, InsightsGroup>()
    for (const row of usageByModel) out.set(row.key.trim().toLowerCase(), row)
    return out
  }, [usageByModel])

  const runs30dByJob = useMemo(() => {
    const start = startOfUtcDay(new Date())
    const end = addUtcDays(start, 29)
    const out = new Map<string, number>()
    for (const { row, schedule } of calendarJobs) {
      out.set(row.id, estimateRunsInUtcRange(schedule, start, end))
    }
    return out
  }, [calendarJobs])

  const scheduledRuns30dByAgent = useMemo(() => {
    const out = new Map<string, number>()

    for (const job of filteredCronJobs) {
      if (!job.enabled) continue
      const candidateTokens = [job.raw.agentId, job.raw.payload?.to]
        .map((v) => v?.trim().toLowerCase())
        .filter((v): v is string => Boolean(v))

      const matchedAgent = candidateTokens
        .map((token) => agentByToken.get(token))
        .find((row): row is AgentModelRow => Boolean(row))

      const agentKey = matchedAgent?.runtimeAgentId?.trim().toLowerCase() ?? candidateTokens[0]
      if (!agentKey) continue

      const runs = runs30dByJob.get(job.id) ?? 0
      out.set(agentKey, (out.get(agentKey) ?? 0) + runs)
    }

    return out
  }, [agentByToken, filteredCronJobs, runs30dByJob])

  const costEstimateByJob = useMemo(() => {
    const out = new Map<string, CronCostEstimate>()

    for (const job of filteredCronJobs) {
      const candidateTokens = [job.raw.agentId, job.raw.payload?.to]
        .map((v) => v?.trim().toLowerCase())
        .filter((v): v is string => Boolean(v))

      const matchedAgent = candidateTokens
        .map((token) => agentByToken.get(token))
        .find((row): row is AgentModelRow => Boolean(row))

      const runtimeAgentId = matchedAgent?.runtimeAgentId?.trim().toLowerCase() ?? candidateTokens[0] ?? null
      const modelId = matchedAgent?.model ?? defaultModelId

      const agentUsage = runtimeAgentId ? usageByAgentMap.get(runtimeAgentId) : undefined
      const modelUsage = modelId ? usageByModelMap.get(modelId.trim().toLowerCase()) : undefined

      const scheduledRuns = runtimeAgentId ? (scheduledRuns30dByAgent.get(runtimeAgentId) ?? 0) : 0
      const estimatedRuns30d = runs30dByJob.get(job.id) ?? 0

      const agentTotalTokens = parseBigIntSafe(agentUsage?.totalTokens ?? '0')
      const agentTotalCostMicros = parseBigIntSafe(agentUsage?.totalCostMicros ?? '0')
      const modelTotalTokens = parseBigIntSafe(modelUsage?.totalTokens ?? '0')
      const modelTotalCostMicros = parseBigIntSafe(modelUsage?.totalCostMicros ?? '0')

      let confidence: CronCostEstimate['confidence'] = 'none'
      let tokensPerRun: number | null = null
      let costMicrosPerRun: number | null = null

      if (scheduledRuns > 0 && agentTotalTokens > 0n) {
        tokensPerRun = bigIntToApproxNumber(agentTotalTokens) / scheduledRuns
        confidence = 'medium'
      } else if ((modelUsage?.sessionCount ?? 0) > 0 && modelTotalTokens > 0n) {
        tokensPerRun = bigIntToApproxNumber(modelTotalTokens) / modelUsage!.sessionCount
        confidence = 'low'
      }

      if (tokensPerRun !== null && modelTotalTokens > 0n && modelTotalCostMicros > 0n) {
        const modelCostPerToken = bigIntToApproxNumber(modelTotalCostMicros) / bigIntToApproxNumber(modelTotalTokens)
        costMicrosPerRun = tokensPerRun * modelCostPerToken
        confidence = confidence === 'medium' ? 'high' : 'medium'
      } else if (scheduledRuns > 0 && agentTotalCostMicros > 0n) {
        costMicrosPerRun = bigIntToApproxNumber(agentTotalCostMicros) / scheduledRuns
        if (confidence === 'none') confidence = 'low'
      }

      const projectedTokens30d = tokensPerRun === null ? null : tokensPerRun * estimatedRuns30d
      const projectedCostMicros30d = costMicrosPerRun === null ? null : costMicrosPerRun * estimatedRuns30d

      out.set(job.id, {
        modelId,
        modelLabel: modelShortLabel(modelId),
        confidence,
        estimatedRuns30d,
        tokensPerRun,
        costMicrosPerRun,
        projectedTokens30d,
        projectedCostMicros30d,
      })
    }

    return out
  }, [
    agentByToken,
    defaultModelId,
    filteredCronJobs,
    runs30dByJob,
    scheduledRuns30dByAgent,
    usageByAgentMap,
    usageByModelMap,
  ])

  const projectedTotals30d = useMemo(() => {
    let tokens = 0
    let cost = 0

    for (const estimate of costEstimateByJob.values()) {
      tokens += estimate.projectedTokens30d ?? 0
      cost += estimate.projectedCostMicros30d ?? 0
    }

    return { tokens, cost }
  }, [costEstimateByJob])

  const isBackgroundLoading =
    isHealthLoading || isUsageLoading || isAgentOverlayLoading || isModelInfoLoading

  const hydrateHealth = useCallback(async () => {
    setIsHealthLoading(true)
    try {
      const response = await timedFetchWithTimeout(
        '/api/openclaw/cron/health?days=7',
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
        },
        12_000,
        {
          page: 'cron',
          name: 'cron.health',
        }
      )

      if (!response.ok) return

      const health = (await response.json()) as { data?: CronHealthReport }
      if (health.data) {
        setHealthReport(health.data)
      }
    } catch {
      // Non-critical: keep stale health data instead of blocking interaction.
    } finally {
      setIsHealthLoading(false)
    }
  }, [])

  const hydrateUsage = useCallback(async () => {
    setIsUsageLoading(true)
    try {
      const response = await timedFetchWithTimeout(
        '/api/openclaw/usage/breakdown?groupBy=both',
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
        },
        12_000,
        {
          page: 'cron',
          name: 'usage.breakdown.both',
        }
      )

      if (!response.ok) return

      const payload = (await response.json()) as {
        data?: {
          byAgent?: InsightsGroup[]
          byModel?: InsightsGroup[]
          groups?: InsightsGroup[]
          groupBy?: 'both' | 'agent' | 'model'
        }
      }

      if (payload.data?.groupBy === 'both') {
        setUsageByAgent(Array.isArray(payload.data.byAgent) ? payload.data.byAgent : [])
        setUsageByModel(Array.isArray(payload.data.byModel) ? payload.data.byModel : [])
        return
      }

      // Backward compatibility if server does not support groupBy=both yet.
      if (Array.isArray(payload.data?.groups)) {
        setUsageByModel(payload.data.groups)
      }
    } catch {
      // Non-critical.
    } finally {
      setIsUsageLoading(false)
    }
  }, [])

  const hydrateAgentOverlays = useCallback(async () => {
    setIsAgentOverlayLoading(true)
    try {
      const response = await timedFetchWithTimeout(
        '/api/agents?mode=light&includeSessionOverlay=0&includeModelOverlay=0&syncSessions=0',
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
        },
        12_000,
        {
          page: 'cron',
          name: 'agents.light',
        }
      )

      if (!response.ok) return

      const payload = (await response.json()) as { data?: AgentModelRow[] }
      if (Array.isArray(payload.data)) {
        setAgentModels(payload.data)
      }
    } catch {
      // Non-critical.
    } finally {
      setIsAgentOverlayLoading(false)
    }
  }, [])

  const hydrateModelInfo = useCallback(async () => {
    setIsModelInfoLoading(true)
    try {
      const response = await timedFetchWithTimeout(
        '/api/models',
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
        },
        12_000,
        {
          page: 'cron',
          name: 'models.status',
        }
      )

      if (!response.ok) return

      const modelsPayload = (await response.json()) as {
        data?: { status?: { resolvedDefault?: string; defaultModel?: string } }
      }

      setDefaultModelId(
        modelsPayload.data?.status?.resolvedDefault ??
          modelsPayload.data?.status?.defaultModel ??
          null
      )
    } catch {
      // Non-critical.
    } finally {
      setIsModelInfoLoading(false)
    }
  }, [])

  const refreshJobs = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await timedFetchWithTimeout(
        '/api/openclaw/cron/jobs',
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
        },
        15_000,
        {
          page: 'cron',
          name: 'cron.jobs',
        }
      )

      const data = (await response.json()) as OpenClawResponse<unknown>
      setAvailability(data)

      if (data.status === 'unavailable') {
        setCronJobs([])
        setError(data.error ?? 'Unable to load cron jobs')
        return
      }

      const raw = data.data as unknown
      const jobsArray: CliCronJob[] = Array.isArray(raw)
        ? (raw as CliCronJob[])
        : (raw as { jobs?: CliCronJob[] } | null)?.jobs ?? []

      setCronJobs(jobsArray.map(mapToUiDto))

      // Hydrate non-critical datasets in the background.
      void Promise.allSettled([
        hydrateHealth(),
        hydrateUsage(),
        hydrateAgentOverlays(),
        hydrateModelInfo(),
      ])
    } catch (err) {
      setAvailability(null)
      setCronJobs([])
      setError(err instanceof Error ? err.message : 'Unable to load cron jobs')
    } finally {
      setIsLoading(false)
    }
  }, [hydrateAgentOverlays, hydrateHealth, hydrateModelInfo, hydrateUsage])

  useEffect(() => {
    refreshJobs()
  }, [refreshJobs])

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(interval)
  }, [])

  const handleJobCreated = async () => {
    await refreshJobs()
    setCreateModalOpen(false)
  }

  const handleJobDeleted = async () => {
    await refreshJobs()
    setSelectedId(undefined)
  }

  const nowLocalLabel = useMemo(
    () =>
      new Date(nowMs).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    [nowMs]
  )

  const calendarLabel = useMemo(() => {
    if (calendarView === 'day') {
      return calendarAnchor.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    }

    if (calendarView === 'week') {
      const weekStart = startOfLocalWeek(calendarAnchor)
      const end = addLocalDays(weekStart, 6)
      return `${weekStart.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
    }

    if (calendarView === 'month') {
      return calendarAnchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    }

    return calendarAnchor.toLocaleDateString(undefined, { year: 'numeric' })
  }, [calendarAnchor, calendarView])

  const shiftCalendar = useCallback((delta: number) => {
    setCalendarAnchor((prev) => {
      if (calendarView === 'day') return addLocalDays(prev, delta)
      if (calendarView === 'week') return addLocalDays(prev, delta * 7)
      if (calendarView === 'month') return addLocalMonths(prev, delta)
      return addLocalYears(prev, delta)
    })
  }, [calendarView])

  const monthCells = useMemo(() => {
    if (calendarView !== 'month') return []
    return monthGridCellsLocal(new Date(calendarAnchor.getFullYear(), calendarAnchor.getMonth(), 1))
  }, [calendarAnchor, calendarView])

  const dayViewDate = useMemo(
    () => (calendarView === 'day' ? startOfLocalDay(calendarAnchor) : null),
    [calendarAnchor, calendarView]
  )

  const weekViewDays = useMemo(() => {
    if (calendarView !== 'week') return []
    const weekStart = startOfLocalWeek(calendarAnchor)
    return listLocalDaysInRange(weekStart, addLocalDays(weekStart, 6))
  }, [calendarAnchor, calendarView])

  return (
    <>
      <div className="w-full space-y-4">
        {availability && (
          <div>
            <AvailabilityBadge
              status={availability.status}
              latencyMs={availability.latencyMs}
              cached={availability.cached}
              staleAgeMs={availability.staleAgeMs}
              label="Cron"
              size="sm"
            />
          </div>
        )}

        <PageHeader
          title="Cron Jobs"
          subtitle={
            searchText.trim()
              ? `${filteredCronJobs.length} shown (${enabledCount} enabled / ${cronJobs.length} total)`
              : `${enabledCount} enabled / ${cronJobs.length} total`
          }
          actions={
            <>
              <SegmentedToggle
                value={calendarMode}
                onChange={setCalendarMode}
                tone="neutral"
                ariaLabel="Cron view mode"
                items={[
                  {
                    value: 'list',
                    label: (
                      <>
                        <List className="w-3.5 h-3.5" />
                        List
                      </>
                    ),
                  },
                  {
                    value: 'calendar',
                    label: (
                      <>
                        <CalendarDays className="w-3.5 h-3.5" />
                        Calendar
                      </>
                    ),
                  },
                ]}
              />

              <Button
                onClick={refreshJobs}
                disabled={isLoading}
                variant="secondary"
                size="sm"
              >
                <RefreshCw className={cn('w-3.5 h-3.5', (isLoading || isBackgroundLoading) && 'animate-spin')} />
                {isLoading ? 'Refreshing...' : 'Refresh'}
              </Button>

              <Button
                onClick={() => setCreateModalOpen(true)}
                variant="primary"
                size="sm"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Job
              </Button>
            </>
          }
        />

        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search cron jobs by name, schedule, agent, or payload..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-bg-3 border border-bd-0 rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-3 focus:outline-none focus:ring-1 focus:ring-status-info/50"
          />
        </div>

        {(healthReport || isHealthLoading) && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <HealthCard
              label="Avg success"
              value={healthReport ? `${healthReport.summary.avgSuccessRatePct.toFixed(1)}%` : '...'}
            />
            <HealthCard label="Failures (7d)" value={healthReport ? String(healthReport.summary.totalFailures) : '...'} />
            <HealthCard label="Jobs w/ failures" value={healthReport ? String(healthReport.summary.jobsWithFailures) : '...'} />
            <HealthCard label="Flaky jobs" value={healthReport ? String(healthReport.summary.flakyJobs) : '...'} />
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <HealthCard label="Projected tokens (30d)" value={formatTokenCount(projectedTotals30d.tokens)} />
          <HealthCard label="Projected cost (30d)" value={formatUsdMicros(projectedTotals30d.cost)} />
          <HealthCard label="Models resolved" value={String(Array.from(costEstimateByJob.values()).filter((v) => v.modelId).length)} />
          <HealthCard
            label="Estimates available"
            value={String(Array.from(costEstimateByJob.values()).filter((v) => v.projectedTokens30d !== null).length)}
          />
        </div>

        {error && (
          <div className="p-3 bg-status-danger/10 border border-status-danger/20 rounded-[var(--radius-md)] text-status-danger text-sm">
            {error}
          </div>
        )}

        {isBackgroundLoading && (
          <div className="flex items-center gap-2 text-fg-3 text-xs">
            <InlineLoading
              label="Hydrating health and cost insights in background..."
              size="sm"
              className="text-fg-3 text-xs"
            />
          </div>
        )}

        {isLoading && (
          <div className="flex items-center gap-2 text-fg-3 text-sm">
            <InlineLoading label="Loading crons..." size="md" className="text-fg-3" />
          </div>
        )}

        {calendarMode === 'list' ? (
          <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0 overflow-hidden">
            <CanonicalTable
              columns={cronColumns}
              rows={filteredCronJobs}
              rowKey={(row) => row.id}
              onRowClick={(row) => setSelectedId(row.id)}
              selectedKey={selectedId}
              density="compact"
              emptyState={
                <EmptyState
                  icon={<Clock className="w-8 h-8" />}
                  title={searchText.trim() ? 'No matching jobs' : 'No scheduled jobs'}
                  description={searchText.trim() ? 'Try a different search term.' : 'Sync with OpenClaw to import jobs.'}
                />
              }
            />
          </div>
        ) : (
          <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0 overflow-hidden p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-fg-1" />
                <h2 className="text-sm font-medium text-fg-0">Schedule Calendar</h2>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center bg-bg-3 border border-bd-0 rounded-[var(--radius-md)] overflow-hidden">
                  {(['day', 'week', 'month', 'year'] as const).map((view) => (
                    <button
                      key={view}
                      onClick={() => setCalendarView(view)}
                      className={cn(
                        'px-2 py-1.5 text-xs capitalize',
                        calendarView === view ? 'bg-bg-2 text-fg-0' : 'text-fg-2 hover:text-fg-1'
                      )}
                    >
                      {view}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => setCalendarAnchor(startOfLocalDay(new Date()))}
                  className="px-2.5 py-1.5 text-xs bg-bg-3 border border-bd-0 rounded-[var(--radius-md)] text-fg-1 hover:text-fg-0"
                >
                  Today
                </button>

                <button
                  onClick={() => shiftCalendar(-1)}
                  className="p-1.5 rounded hover:bg-bg-3 text-fg-2"
                  aria-label="Previous"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => shiftCalendar(1)}
                  className="p-1.5 rounded hover:bg-bg-3 text-fg-2"
                  aria-label="Next"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="text-xs text-fg-2">
              {calendarLabel} ({userTimeZone}) {calendarView !== 'year' ? `• Now: ${nowLocalLabel}` : ''}
            </div>

            {calendarView === 'year' ? (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
                {yearBuckets.map((bucket) => (
                  <button
                    key={bucket.monthIndex}
                    onClick={() => {
                      setCalendarView('month')
                      setCalendarAnchor(new Date(calendarAnchor.getFullYear(), bucket.monthIndex, 1))
                    }}
                    className={cn(
                      'rounded-[var(--radius-md)] p-3 text-left transition-colors',
                      bucket.totalRuns > 0
                        ? 'bg-status-info/10 hover:bg-status-info/20'
                        : 'bg-bg-3/40 hover:bg-bg-3/60'
                    )}
                  >
                    <div className="text-xs text-fg-1">{bucket.monthLabel}</div>
                    <div className="mt-1 text-lg font-semibold text-fg-0">{bucket.totalRuns}</div>
                    <div className="text-[11px] text-fg-2">scheduled runs</div>
                    <div className="mt-2 text-[11px] text-fg-2 truncate">
                      {bucket.jobs[0] ? `${bucket.jobs[0].job.name} (${bucket.jobs[0].runs})` : 'No scheduled jobs'}
                    </div>
                  </button>
                ))}
              </div>
            ) : calendarView === 'month' ? (
              <div className="space-y-2">
                <div className="grid grid-cols-7 text-xs text-fg-2 bg-bg-3/50 rounded-[var(--radius-md)] overflow-hidden">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label) => (
                    <div key={label} className="py-2 text-center">{label}</div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-1">
                  {monthCells.map((cell, idx) => {
                    if (!cell.date) {
                      return <div key={`empty-${idx}`} className="h-28 rounded-[var(--radius-md)] bg-bg-3/20" />
                    }

                    const key = localDayKey(cell.date)
                    const bucket = dayBucketsByKey.get(key)

                    return (
                      <button
                        key={key}
                        onClick={() => {
                          setCalendarAnchor(startOfLocalDay(cell.date!))
                          setCalendarView('day')
                        }}
                        className={cn(
                          'h-28 rounded-[var(--radius-md)] p-2 text-left transition-colors',
                          bucket && bucket.totalRuns > 0
                            ? 'bg-status-info/10 hover:bg-status-info/20'
                            : 'bg-bg-3/[0.35] hover:bg-bg-3/[0.55]'
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-fg-1">{cell.date.getDate()}</span>
                          <span className="text-[11px] text-fg-2">{bucket?.totalRuns ?? 0}</span>
                        </div>
                        <div className="mt-2 text-[11px] text-fg-2">runs</div>
                        <div className="mt-1 text-[11px] text-fg-2 truncate">
                          {bucket?.jobs[0]?.job.name ?? '—'}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : calendarView === 'week' ? (
              <div
                className="rounded-[var(--radius-md)] overflow-y-auto overflow-x-hidden border border-bd-0"
                style={{
                  background: 'linear-gradient(180deg, rgb(28 28 28 / 0.95) 0%, rgb(12 12 12 / 0.92) 100%)',
                }}
              >
                <div style={{ minWidth: '100%' }}>
                  <div className="grid grid-cols-[60px_repeat(7,minmax(0,1fr))]">
                    <div className="h-12" />
                    {weekViewDays.map((day) => {
                      const dayKey = localDayKey(day)
                      const bucket = dayBucketsByKey.get(dayKey)
                      return (
                        <button
                          key={dayKey}
                          onClick={() => {
                            setCalendarAnchor(startOfLocalDay(day))
                            setCalendarView('day')
                          }}
                          className="h-12 px-2 text-left border-l border-bd-0 hover:bg-bg-3 transition-colors"
                          style={{
                            background: 'linear-gradient(180deg, rgb(38 38 38 / 0.9) 0%, rgb(23 23 23 / 0.85) 100%)',
                          }}
                        >
                          <div className="text-xs text-fg-1">{day.toLocaleDateString(undefined, { weekday: 'short' })}</div>
                          <div className="text-[11px] text-fg-2">{day.getDate()} • {bucket?.totalRuns ?? 0}</div>
                        </button>
                      )
                    })}
                  </div>

                  <div className="grid grid-cols-[60px_repeat(7,minmax(0,1fr))]">
                    <div
                      className="relative border-r border-bd-0"
                      style={{
                        height: `${TIMELINE_HEIGHT_PX}px`,
                        background: 'linear-gradient(180deg, rgb(30 30 30 / 0.9) 0%, rgb(20 20 20 / 0.86) 100%)',
                      }}
                    >
                      {Array.from({ length: 24 }, (_, hour) => (
                        <div key={hour} className="absolute left-0 right-0 text-[10px] text-fg-3 px-1" style={{ top: `${(hour / 24) * 100}%` }}>
                          {String(hour).padStart(2, '0')}:00
                        </div>
                      ))}
                    </div>

                    {weekViewDays.map((day) => {
                      const dayKey = localDayKey(day)
                      const events = timelineEventsByDayKey.get(dayKey) ?? []
                      const renderData = buildTimelineRenderData(events, TIMELINE_WEEK_MAX_COLUMNS)
                      const isToday = isSameLocalDay(day, new Date(nowMs))
                      const nowMinute = new Date(nowMs).getHours() * 60 + new Date(nowMs).getMinutes()

                      return (
                        <div
                          key={dayKey}
                          className="relative border-l border-bd-0"
                          style={{
                            height: `${TIMELINE_HEIGHT_PX}px`,
                            background: 'linear-gradient(180deg, rgb(22 22 22 / 0.9) 0%, rgb(16 16 16 / 0.82) 100%)',
                          }}
                        >
                          {Array.from({ length: 24 }, (_, hour) => (
                            <div
                              key={hour}
                              className="absolute left-0 right-0 h-px"
                              style={{
                                top: `${(hour / 24) * 100}%`,
                                backgroundColor: 'rgb(64 64 64 / 0.5)',
                              }}
                            />
                          ))}
                          {isToday && (
                            <div
                              className="absolute left-0 right-0 h-[2px] z-20"
                              style={{
                                top: `${(nowMinute / 1440) * 100}%`,
                                backgroundColor: 'rgb(220 38 38 / 0.85)',
                              }}
                            />
                          )}
                          {renderData.visibleEvents.map((event) => {
                            const compact = event.heightPercent < 2.4 || event.laneCount > 2
                            const placement = timelineColumnInsets(event, TIMELINE_WEEK_MAX_COLUMNS, 4)
                            return (
                              <button
                                key={event.key}
                                onClick={() => setSelectedId(event.job.id)}
                                className="absolute relative rounded-[var(--radius-md)] border text-left z-10 overflow-hidden hover:brightness-110 transition-[filter]"
                                style={{
                                  ...TIMELINE_EVENT_CHROME,
                                  top: `${event.topPercent}%`,
                                  height: `${event.heightPercent}%`,
                                  left: placement.left,
                                  right: placement.right,
                                }}
                                title={`${event.job.name} • ${formatMinuteLabel(day, event.minuteOfDay)}`}
                              >
                                <span
                                  className="absolute left-0 top-0 bottom-0 w-1"
                                  style={{ backgroundColor: 'rgb(96 165 250 / 0.88)' }}
                                />
                                <div className={cn('h-full pl-2 pr-1.5 py-1', compact && 'py-0.5')}>
                                  <div className={cn('truncate text-fg-0', compact ? 'text-[10px] leading-tight font-medium' : 'text-[11px] leading-tight font-semibold')}>
                                    {event.job.name}
                                  </div>
                                  {!compact && (
                                    <div className="text-[10px] text-fg-1 leading-tight mt-0.5">
                                      {formatMinuteLabel(day, event.minuteOfDay)}{event.runs > 1 ? ` • ${event.runs} runs` : ''}
                                    </div>
                                  )}
                                </div>
                              </button>
                            )
                          })}
                          {renderData.overflowBadges.map((badge) => (
                            <button
                              key={badge.key}
                              onClick={() => setSelectedId(badge.primaryJobId)}
                              className="absolute right-1 z-20 px-1.5 py-0.5 text-[10px] font-medium text-fg-1 border rounded-[var(--radius-sm)] hover:text-fg-0"
                              style={{
                                ...TIMELINE_OVERFLOW_CHROME,
                                top: `calc(${badge.topPercent}% + 2px)`,
                              }}
                              title={`${badge.hiddenCount} additional overlapping jobs`}
                            >
                              +{badge.hiddenCount} more
                            </button>
                          ))}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div
                className="rounded-[var(--radius-md)] overflow-y-auto overflow-x-hidden border border-bd-0"
                style={{
                  background: 'linear-gradient(180deg, rgb(28 28 28 / 0.95) 0%, rgb(12 12 12 / 0.92) 100%)',
                }}
              >
                {dayViewDate && (
                  <div className="grid grid-cols-[60px_1fr]" style={{ minWidth: '100%' }}>
                    <div
                      className="relative border-r border-bd-0"
                      style={{
                        height: `${TIMELINE_HEIGHT_PX}px`,
                        background: 'linear-gradient(180deg, rgb(30 30 30 / 0.9) 0%, rgb(20 20 20 / 0.86) 100%)',
                      }}
                    >
                      {Array.from({ length: 24 }, (_, hour) => (
                        <div key={hour} className="absolute left-0 right-0 text-[10px] text-fg-3 px-1" style={{ top: `${(hour / 24) * 100}%` }}>
                          {String(hour).padStart(2, '0')}:00
                        </div>
                      ))}
                    </div>
                    <div
                      className="relative"
                      style={{
                        height: `${TIMELINE_HEIGHT_PX}px`,
                        background: 'linear-gradient(180deg, rgb(22 22 22 / 0.92) 0%, rgb(16 16 16 / 0.82) 100%)',
                      }}
                    >
                      {Array.from({ length: 24 }, (_, hour) => (
                        <div
                          key={hour}
                          className="absolute left-0 right-0 h-px"
                          style={{
                            top: `${(hour / 24) * 100}%`,
                            backgroundColor: 'rgb(64 64 64 / 0.52)',
                          }}
                        />
                      ))}
                      {isSameLocalDay(dayViewDate, new Date(nowMs)) && (
                        <div
                          className="absolute left-0 right-0 h-[2px] z-20"
                          style={{
                            top: `${((new Date(nowMs).getHours() * 60 + new Date(nowMs).getMinutes()) / 1440) * 100}%`,
                            backgroundColor: 'rgb(220 38 38 / 0.85)',
                          }}
                        />
                      )}
                      {(() => {
                        const renderData = buildTimelineRenderData(
                          timelineEventsByDayKey.get(localDayKey(dayViewDate)) ?? [],
                          TIMELINE_DAY_MAX_COLUMNS
                        )

                        return (
                          <>
                            {renderData.visibleEvents.map((event) => {
                              const compact = event.heightPercent < 2.2 || event.laneCount > 3
                              const placement = timelineColumnInsets(event, TIMELINE_DAY_MAX_COLUMNS, 6)
                              return (
                                <button
                                  key={event.key}
                                  onClick={() => setSelectedId(event.job.id)}
                                  className="absolute relative rounded-[var(--radius-md)] border text-left z-10 overflow-hidden hover:brightness-110 transition-[filter]"
                                  style={{
                                    ...TIMELINE_EVENT_CHROME,
                                    top: `${event.topPercent}%`,
                                    height: `${event.heightPercent}%`,
                                    left: placement.left,
                                    right: placement.right,
                                  }}
                                  title={`${event.job.name} • ${formatMinuteLabel(dayViewDate, event.minuteOfDay)}`}
                                >
                                  <span
                                    className="absolute left-0 top-0 bottom-0 w-1"
                                    style={{ backgroundColor: 'rgb(96 165 250 / 0.9)' }}
                                  />
                                  <div className={cn('h-full pl-2.5 pr-2 py-1.5', compact && 'py-0.5')}>
                                    <div className={cn('truncate text-fg-0', compact ? 'text-[11px] leading-tight font-medium' : 'text-xs leading-tight font-semibold')}>
                                      {event.job.name}
                                    </div>
                                    {!compact && (
                                      <div className="text-[11px] text-fg-1 leading-tight mt-0.5">
                                        {formatMinuteLabel(dayViewDate, event.minuteOfDay)}{event.runs > 1 ? ` • ${event.runs} runs` : ''}
                                      </div>
                                    )}
                                  </div>
                                </button>
                              )
                            })}
                            {renderData.overflowBadges.map((badge) => (
                              <button
                                key={badge.key}
                                onClick={() => setSelectedId(badge.primaryJobId)}
                                className="absolute right-2 z-20 px-2 py-0.5 text-[11px] font-medium text-fg-1 border rounded-[var(--radius-sm)] hover:text-fg-0"
                                style={{
                                  ...TIMELINE_OVERFLOW_CHROME,
                                  top: `calc(${badge.topPercent}% + 2px)`,
                                }}
                                title={`${badge.hiddenCount} additional overlapping jobs`}
                              >
                                +{badge.hiddenCount} more
                              </button>
                            ))}
                          </>
                        )
                      })()}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Detail Drawer */}
      <RightDrawer
        open={!!selectedJob}
        onClose={() => setSelectedId(undefined)}
        title={selectedJob?.name}
        description={selectedJob?.description}
      >
        {selectedJob && (
          <CronDetail
            job={selectedJob}
            health={selectedHealth ?? undefined}
            estimate={costEstimateByJob.get(selectedJob.id)}
            onClose={() => setSelectedId(undefined)}
            onUpdated={refreshJobs}
            onDeleted={handleJobDeleted}
          />
        )}
      </RightDrawer>

      {/* Create Job Modal */}
      <CreateCronJobModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreated={handleJobCreated}
      />
    </>
  )
}

function CronDetail({
  job,
  health,
  estimate,
  onClose,
  onUpdated,
  onDeleted,
}: {
  job: CronJobRow
  health?: CronHealthJob
  estimate?: CronCostEstimate
  onClose: () => void
  onUpdated: () => void | Promise<void>
  onDeleted?: () => void
}) {
  const [actionInProgress, setActionInProgress] = useState<'run' | 'toggle' | 'delete' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [editMode, setEditMode] = useState<EditMode>('every')
  const [everyValue, setEveryValue] = useState('20m')
  const [cronValue, setCronValue] = useState('* * * * *')
  const [tzValue, setTzValue] = useState('')
  const [atValue, setAtValue] = useState('')

  const purposeText = (
    job.description
    || job.raw.payload?.message
    || job.raw.payload?.text
    || ''
  ).trim()
  const payloadTarget = [job.raw.payload?.channel, job.raw.payload?.to].filter(Boolean).join(' / ')

  useEffect(() => {
    const schedule = job.raw.schedule
    setDeleteConfirmOpen(false)

    if (schedule.kind === 'every') {
      setEditMode('every')
      setEveryValue(
        typeof schedule.everyMs === 'number' ? formatDurationShort(schedule.everyMs) : '20m'
      )
    } else if (schedule.kind === 'cron') {
      setEditMode('cron')
      setCronValue(schedule.expr ?? '* * * * *')
      setTzValue(schedule.tz ?? '')
    } else if (schedule.kind === 'at') {
      setEditMode('at')
      setAtValue(
        typeof schedule.atMs === 'number' ? new Date(schedule.atMs).toISOString() : ''
      )
    }
  }, [job.id, job.raw.schedule])

  async function handleRunNow() {
    setActionInProgress('run')
    setError(null)

    try {
      const data = await apiPost<OpenClawResponse<unknown>>(`/api/openclaw/cron/${job.id}/run`)

      if (data.status === 'unavailable') {
        setError(data.error ?? 'Failed to run job')
      } else {
        await onUpdated()
        onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run job')
    } finally {
      setActionInProgress(null)
    }
  }

  async function handleToggleEnabled() {
    setActionInProgress('toggle')
    setError(null)

    const endpoint = job.enabled ? 'disable' : 'enable'

    try {
      const data = await apiPost<OpenClawResponse<unknown>>(`/api/openclaw/cron/${job.id}/${endpoint}`)

      if (data.status === 'unavailable') {
        setError(data.error ?? `Failed to ${endpoint} job`)
      } else {
        await onUpdated()
        onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${endpoint} job`)
    } finally {
      setActionInProgress(null)
    }
  }

  function requestDeleteConfirmation() {
    if (actionInProgress) return
    setDeleteConfirmOpen(true)
  }

  async function handleDelete() {
    setActionInProgress('delete')
    setError(null)

    try {
      const data = await apiPost<OpenClawResponse<unknown>>(`/api/openclaw/cron/${job.id}/delete`)

      if (data.status === 'unavailable') {
        setError(data.error ?? 'Failed to delete job')
        setDeleteConfirmOpen(false)
      } else {
        await onUpdated()
        setDeleteConfirmOpen(false)
        onDeleted?.()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete job')
      setDeleteConfirmOpen(false)
    } finally {
      setActionInProgress(null)
    }
  }

  async function handleSaveSchedule() {
    setActionInProgress('save')
    setError(null)

    try {
      const body: Record<string, string> = { mode: editMode }

      if (editMode === 'every') {
        if (!everyValue.trim()) throw new Error('Interval is required')
        body.every = everyValue.trim()
      }

      if (editMode === 'cron') {
        if (!cronValue.trim()) throw new Error('Cron expression is required')
        body.cron = cronValue.trim()
        if (tzValue.trim()) body.tz = tzValue.trim()
      }

      if (editMode === 'at') {
        if (!atValue.trim()) throw new Error('One-time schedule value is required')
        body.at = atValue.trim()
      }

      const data = await apiPost<OpenClawResponse<unknown>>(`/api/openclaw/cron/${job.id}/edit`, body)
      if (data.status === 'unavailable') {
        setError(data.error ?? 'Failed to save schedule')
      } else {
        await onUpdated()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save schedule')
    } finally {
      setActionInProgress(null)
    }
  }

  const isLoading = actionInProgress !== null

  return (
    <>
      <div className="space-y-6">
      {/* Status */}
      <div className="flex items-center gap-3">
        <span className={cn(
          'px-2 py-0.5 text-xs rounded',
          job.enabled
            ? 'bg-status-success/10 text-status-success'
            : 'bg-fg-3/10 text-fg-3'
        )}>
          {job.enabled ? 'Enabled' : 'Disabled'}
        </span>
        {job.lastStatus && (
          <StatusPill
            tone={job.lastStatus === 'success' ? 'success' : job.lastStatus === 'failed' ? 'danger' : 'progress'}
            label={job.lastStatus}
          />
        )}
      </div>

      {/* Schedule */}
      <PageSection title="Job Details">
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-fg-2">What it does</dt>
          <dd className="text-fg-1">{purposeText || 'No description provided.'}</dd>
          <dt className="text-fg-2">Payload kind</dt>
          <dd className="text-fg-1 font-mono text-xs">{job.raw.payload?.kind ?? '—'}</dd>
          <dt className="text-fg-2">Payload target</dt>
          <dd className="text-fg-1 font-mono text-xs">{payloadTarget || '—'}</dd>
          <dt className="text-fg-2">Last failure reason</dt>
          <dd className="text-fg-1 text-xs">
            {health?.lastFailureReason ?? (health ? 'No recent failure reason recorded.' : 'No health data yet.')}
          </dd>
          <dt className="text-fg-2">Reliability (7d)</dt>
          <dd className="text-fg-1 font-mono text-xs">
            {health
              ? `${formatPercent(health.successRatePct)} success • ${health.failureCount} fails • ${formatPercent(health.flakinessScore * 100, 0)} flaky`
              : 'No health data'}
          </dd>
        </dl>
      </PageSection>

      <PageSection title="Schedule">
        <div className="space-y-3">
          <div className="p-3 bg-bg-3 rounded-[var(--radius-md)] border border-bd-0">
            <div className="text-sm text-fg-0 font-medium">{job.schedule}</div>
            <div className="text-xs text-fg-2 mt-1">{job.frequencyText}</div>
            <code className="font-mono text-xs text-fg-2 mt-2 block">{job.rawScheduleText}</code>
          </div>
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <dt className="text-fg-3">Kind</dt>
            <dd className="text-fg-1 font-mono">{job.raw.schedule.kind}</dd>
            <dt className="text-fg-3">Agent</dt>
            <dd className="text-fg-1 font-mono">{job.raw.agentId ?? '—'}</dd>
            <dt className="text-fg-3">Session</dt>
            <dd className="text-fg-1 font-mono">{job.raw.sessionTarget ?? '—'}</dd>
            <dt className="text-fg-3">Wake</dt>
            <dd className="text-fg-1 font-mono">{job.raw.wakeMode ?? '—'}</dd>
          </dl>
        </div>
      </PageSection>

      {/* Edit Schedule */}
      <PageSection title="Edit Frequency">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setEditMode('every')}
              disabled={isLoading}
              className={cn(
                'px-2.5 py-1 text-xs rounded-[var(--radius-md)] border-0 transition-colors',
                editMode === 'every'
                  ? 'bg-status-info/20 text-status-info'
                  : 'bg-bg-3 text-fg-2 hover:text-fg-1'
              )}
            >
              Every
            </button>
            <button
              onClick={() => setEditMode('cron')}
              disabled={isLoading}
              className={cn(
                'px-2.5 py-1 text-xs rounded-[var(--radius-md)] border-0 transition-colors',
                editMode === 'cron'
                  ? 'bg-status-info/20 text-status-info'
                  : 'bg-bg-3 text-fg-2 hover:text-fg-1'
              )}
            >
              Cron
            </button>
            <button
              onClick={() => setEditMode('at')}
              disabled={isLoading}
              className={cn(
                'px-2.5 py-1 text-xs rounded-[var(--radius-md)] border-0 transition-colors',
                editMode === 'at'
                  ? 'bg-status-info/20 text-status-info'
                  : 'bg-bg-3 text-fg-2 hover:text-fg-1'
              )}
            >
              One-time
            </button>
          </div>

          {editMode === 'every' && (
            <div>
              <label className="block text-xs text-fg-2 mb-1">Interval (e.g. `10m`, `1h`, `1d`)</label>
              <input
                value={everyValue}
                onChange={(e) => setEveryValue(e.target.value)}
                disabled={isLoading}
                className="w-full px-3 py-2 text-sm font-mono bg-bg-3 border border-bd-0 rounded-[var(--radius-md)] text-fg-0 focus:outline-none focus:ring-1 focus:ring-status-info/50"
              />
            </div>
          )}

          {editMode === 'cron' && (
            <div className="space-y-2">
              <div>
                <label className="block text-xs text-fg-2 mb-1">Cron expression</label>
                <input
                  value={cronValue}
                  onChange={(e) => setCronValue(e.target.value)}
                  disabled={isLoading}
                  className="w-full px-3 py-2 text-sm font-mono bg-bg-3 border border-bd-0 rounded-[var(--radius-md)] text-fg-0 focus:outline-none focus:ring-1 focus:ring-status-info/50"
                />
              </div>
              <div>
                <label className="block text-xs text-fg-2 mb-1">Timezone (optional)</label>
                <input
                  value={tzValue}
                  onChange={(e) => setTzValue(e.target.value)}
                  disabled={isLoading}
                  placeholder="Europe/Zurich"
                  className="w-full px-3 py-2 text-sm font-mono bg-bg-3 border border-bd-0 rounded-[var(--radius-md)] text-fg-0 focus:outline-none focus:ring-1 focus:ring-status-info/50"
                />
              </div>
            </div>
          )}

          {editMode === 'at' && (
            <div>
              <label className="block text-xs text-fg-2 mb-1">One-time time (ISO or relative, e.g. `+20m`)</label>
              <input
                value={atValue}
                onChange={(e) => setAtValue(e.target.value)}
                disabled={isLoading}
                className="w-full px-3 py-2 text-sm font-mono bg-bg-3 border border-bd-0 rounded-[var(--radius-md)] text-fg-0 focus:outline-none focus:ring-1 focus:ring-status-info/50"
              />
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={handleSaveSchedule}
              disabled={isLoading}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium border-0 transition-colors',
                'bg-status-info/20 text-status-info hover:bg-status-info/30',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {actionInProgress === 'save' ? (
                <LoadingSpinner size="sm" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              Save Schedule
            </button>
          </div>
        </div>
      </PageSection>

      {/* Actions */}
      <PageSection title="Actions">
        {error && (
          <div className="mb-3 p-2 bg-status-error/10 rounded text-status-error text-sm">
            {error}
          </div>
        )}
        <div className="flex gap-2">
          <Button
            onClick={handleRunNow}
            disabled={isLoading}
            variant="secondary"
            size="md"
          >
            {actionInProgress === 'run' ? (
              <LoadingSpinner size="sm" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            Run Now
          </Button>
          <Button
            onClick={handleToggleEnabled}
            disabled={isLoading}
            variant="secondary"
            size="md"
          >
            {actionInProgress === 'toggle' ? (
              <LoadingSpinner size="sm" />
            ) : job.enabled ? (
              <Pause className="w-3.5 h-3.5" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            {job.enabled ? 'Disable' : 'Enable'}
          </Button>
          <Button
            onClick={requestDeleteConfirmation}
            disabled={isLoading}
            variant="danger"
            size="md"
          >
            {actionInProgress === 'delete' ? (
              <LoadingSpinner size="sm" />
            ) : (
              <Trash2 className="w-3.5 h-3.5" />
            )}
            Delete
          </Button>
        </div>
      </PageSection>

      {/* Stats */}
      {estimate && (
        <PageSection title="Estimated Token Cost (30d)">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-fg-2">Model</dt>
            <dd className="text-fg-1 font-mono text-xs">{estimate.modelLabel}</dd>
            <dt className="text-fg-2">Est. Runs</dt>
            <dd className="text-fg-1 font-mono">{estimate.estimatedRuns30d}</dd>
            <dt className="text-fg-2">Tokens / Run</dt>
            <dd className="text-fg-1 font-mono">{formatTokenCount(estimate.tokensPerRun)}</dd>
            <dt className="text-fg-2">Cost / Run</dt>
            <dd className="text-fg-1 font-mono">{formatUsdMicros(estimate.costMicrosPerRun)}</dd>
            <dt className="text-fg-2">Projected Tokens</dt>
            <dd className="text-fg-1 font-mono">{formatTokenCount(estimate.projectedTokens30d)}</dd>
            <dt className="text-fg-2">Projected Cost</dt>
            <dd className="text-fg-1 font-mono">{formatUsdMicros(estimate.projectedCostMicros30d)}</dd>
          </dl>
          <p className="mt-2 text-xs text-fg-2">
            Approximation based on agent/model usage over the last 30 days and this job&apos;s schedule.
          </p>
        </PageSection>
      )}

      <PageSection title="Statistics">
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-fg-2">Total Runs</dt>
          <dd className="text-fg-1 font-mono">{job.runCount}</dd>
          <dt className="text-fg-2">Last Run</dt>
          <dd className="text-fg-1 font-mono text-xs">
            {job.lastRunAt ? formatRelativeTime(job.lastRunAt) : 'Never'}
          </dd>
          <dt className="text-fg-2">Next Run</dt>
          <dd className="text-fg-1 font-mono text-xs">
            {job.nextRunAt ? formatRelativeTime(job.nextRunAt) : '—'}
          </dd>
        </dl>
      </PageSection>
      </div>

      <ActionConfirmModal
        open={deleteConfirmOpen}
        onClose={() => {
          if (actionInProgress === 'delete') return
          setDeleteConfirmOpen(false)
        }}
        onConfirm={handleDelete}
        title="Delete Cron Job"
        description={`Remove "${job.name}" permanently?`}
        notice="This will permanently delete the cron job and cannot be undone."
        confirmLabel={actionInProgress === 'delete' ? 'Deleting...' : 'Delete Job'}
        isLoading={actionInProgress === 'delete'}
        intent="danger"
      />
    </>
  )
}

function HealthCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 bg-bg-2 rounded-[var(--radius-md)] border border-bd-0">
      <div className="text-xs text-fg-2">{label}</div>
      <div className="mt-1 text-lg font-semibold text-fg-0">{value}</div>
    </div>
  )
}

function formatRelativeTime(date: Date | string): string {
  const now = new Date()
  const d = typeof date === 'string' ? new Date(date) : date
  const diff = d.getTime() - now.getTime()
  const absDiff = Math.abs(diff)
  const mins = Math.floor(absDiff / 60000)
  const hours = Math.floor(absDiff / 3600000)
  const days = Math.floor(absDiff / 86400000)

  if (diff > 0) {
    // Future
    if (mins < 60) return `in ${mins}m`
    if (hours < 24) return `in ${hours}h`
    return `in ${days}d`
  } else {
    // Past
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    if (hours < 24) return `${hours}h ago`
    return `${days}d ago`
  }
}

// ============================================================================
// CREATE CRON JOB MODAL
// ============================================================================

interface CreateCronJobModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void | Promise<void>
}

function CreateCronJobModal({ isOpen, onClose, onCreated }: CreateCronJobModalProps) {
  const [name, setName] = useState('')
  const [scheduleKind, setScheduleKind] = useState<CronCreateFormValues['scheduleKind']>('cron')
  const [cronExpr, setCronExpr] = useState('0 * * * *')
  const [everyValue, setEveryValue] = useState('20m')
  const [atValue, setAtValue] = useState('')
  const [tzValue, setTzValue] = useState('')
  const [staggerValue, setStaggerValue] = useState('')
  const [exact, setExact] = useState(false)
  const [payloadKind, setPayloadKind] = useState<CronCreateFormValues['payloadKind']>('agentTurn')
  const [payloadText, setPayloadText] = useState('')
  const [sessionTarget, setSessionTarget] = useState<CronCreateFormValues['sessionTarget']>('isolated')
  const [wakeMode, setWakeMode] = useState<CronCreateFormValues['wakeMode']>('now')
  const [deliveryMode, setDeliveryMode] = useState<CronCreateFormValues['deliveryMode']>('none')
  const [deliveryChannel, setDeliveryChannel] = useState('')
  const [deliveryTo, setDeliveryTo] = useState('')
  const [deliveryBestEffort, setDeliveryBestEffort] = useState(false)
  const [enabled, setEnabled] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setName('')
      setScheduleKind('cron')
      setCronExpr('0 * * * *')
      setEveryValue('20m')
      setAtValue('')
      setTzValue('')
      setStaggerValue('')
      setExact(false)
      setPayloadKind('agentTurn')
      setPayloadText('')
      setSessionTarget('isolated')
      setWakeMode('now')
      setDeliveryMode('none')
      setDeliveryChannel('')
      setDeliveryTo('')
      setDeliveryBestEffort(false)
      setEnabled(true)
      setError(null)
      setTimeout(() => nameInputRef.current?.focus(), 100)
    }
  }, [isOpen])

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isSubmitting) {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isSubmitting, onClose])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const built = buildCronCreateBody({
      name,
      enabled,
      scheduleKind,
      cronExpr,
      every: everyValue,
      at: atValue,
      tz: tzValue,
      stagger: staggerValue,
      exact,
      payloadKind,
      payloadText,
      sessionTarget,
      wakeMode,
      deliveryMode,
      deliveryChannel,
      deliveryTo,
      deliveryBestEffort,
    })

    if (!built.ok) {
      setError(built.error)
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const data = await apiPost<OpenClawResponse<unknown>>('/api/openclaw/cron', built.body)

      if (data.status === 'unavailable') {
        setError(data.error || 'Failed to create cron job')
      } else {
        await onCreated()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create cron job')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  const isScheduleValid = (
    (scheduleKind === 'cron' && cronExpr.trim().length > 0)
    || (scheduleKind === 'every' && everyValue.trim().length > 0)
    || (scheduleKind === 'at' && atValue.trim().length > 0)
  )
  const canSubmit = Boolean(name.trim() && payloadText.trim() && isScheduleValid)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={!isSubmitting ? onClose : undefined}
      />

      {/* Modal */}
      <div className="relative bg-bg-1 border border-bd-1 rounded-[var(--radius-lg)] shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-bd-0">
          <h2 className="text-base font-medium text-fg-0">New Cron Job</h2>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 text-fg-2 hover:text-fg-0 hover:bg-bg-3 rounded-[var(--radius-md)] transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto max-h-[calc(90vh-72px)]">
          {/* Name */}
          <div>
            <label htmlFor="cron-name" className="block text-xs font-medium text-fg-1 mb-1.5">
              Name
            </label>
            <input
              ref={nameInputRef}
              id="cron-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., daily-backup"
              disabled={isSubmitting}
              className="w-full px-3 py-2 text-sm bg-bg-2 border border-bd-1 rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-2 focus:outline-none focus:ring-1 focus:ring-status-info/50 disabled:opacity-50"
            />
          </div>

          {/* Schedule Kind */}
          <div>
            <label className="block text-xs font-medium text-fg-1 mb-1.5">Schedule kind</label>
            <div className="inline-flex rounded-[var(--radius-md)] border border-bd-1 overflow-hidden bg-bg-2">
              {(['cron', 'every', 'at'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setScheduleKind(kind)}
                  className={cn(
                    'px-3 py-1.5 text-xs capitalize',
                    scheduleKind === kind ? 'bg-bg-3 text-fg-0' : 'text-fg-2 hover:text-fg-1'
                  )}
                >
                  {kind}
                </button>
              ))}
            </div>
          </div>

          {/* Schedule Fields */}
          {scheduleKind === 'cron' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-fg-1 mb-1.5">Cron expression</label>
                <input
                  type="text"
                  value={cronExpr}
                  onChange={(e) => setCronExpr(e.target.value)}
                  placeholder="0 * * * *"
                  disabled={isSubmitting}
                  className="w-full px-3 py-2 text-sm font-mono bg-bg-2 border border-bd-1 rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-2 focus:outline-none focus:ring-1 focus:ring-status-info/50 disabled:opacity-50"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-fg-1 mb-1.5">Timezone (optional)</label>
                  <input
                    type="text"
                    value={tzValue}
                    onChange={(e) => setTzValue(e.target.value)}
                    placeholder="UTC"
                    disabled={isSubmitting}
                    className="w-full px-3 py-2 text-sm bg-bg-2 border border-bd-1 rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-2 focus:outline-none focus:ring-1 focus:ring-status-info/50 disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-fg-1 mb-1.5">Stagger (optional)</label>
                  <input
                    type="text"
                    value={staggerValue}
                    onChange={(e) => setStaggerValue(e.target.value)}
                    placeholder="20s"
                    disabled={isSubmitting}
                    className="w-full px-3 py-2 text-sm bg-bg-2 border border-bd-1 rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-2 focus:outline-none focus:ring-1 focus:ring-status-info/50 disabled:opacity-50"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-fg-1">
                <input
                  type="checkbox"
                  checked={exact}
                  onChange={(e) => setExact(e.target.checked)}
                  disabled={isSubmitting}
                  className="rounded border-bd-1"
                />
                Exact cron timing
              </label>
            </div>
          )}

          {scheduleKind === 'every' && (
            <div>
              <label className="block text-xs font-medium text-fg-1 mb-1.5">Every interval</label>
              <input
                type="text"
                value={everyValue}
                onChange={(e) => setEveryValue(e.target.value)}
                placeholder="20m"
                disabled={isSubmitting}
                className="w-full px-3 py-2 text-sm font-mono bg-bg-2 border border-bd-1 rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-2 focus:outline-none focus:ring-1 focus:ring-status-info/50 disabled:opacity-50"
              />
            </div>
          )}

          {scheduleKind === 'at' && (
            <div>
              <label className="block text-xs font-medium text-fg-1 mb-1.5">At time</label>
              <input
                type="text"
                value={atValue}
                onChange={(e) => setAtValue(e.target.value)}
                placeholder="2026-02-20T10:00:00Z or +20m"
                disabled={isSubmitting}
                className="w-full px-3 py-2 text-sm font-mono bg-bg-2 border border-bd-1 rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-2 focus:outline-none focus:ring-1 focus:ring-status-info/50 disabled:opacity-50"
              />
            </div>
          )}

          {/* Payload + Session */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-fg-1 mb-1.5">Payload kind</label>
              <div className="inline-flex rounded-[var(--radius-md)] border border-bd-1 overflow-hidden bg-bg-2">
                {(['agentTurn', 'systemEvent'] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => {
                      setPayloadKind(kind)
                      if (kind === 'agentTurn') {
                        setSessionTarget('isolated')
                      } else {
                        setSessionTarget('main')
                        setDeliveryMode('none')
                      }
                    }}
                    className={cn(
                      'px-3 py-1.5 text-xs',
                      payloadKind === kind ? 'bg-bg-3 text-fg-0' : 'text-fg-2 hover:text-fg-1'
                    )}
                  >
                    {kind}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-fg-1 mb-1.5">Session target</label>
              <div className="inline-flex rounded-[var(--radius-md)] border border-bd-1 overflow-hidden bg-bg-2">
                {(['isolated', 'main'] as const).map((target) => (
                  <button
                    key={target}
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => {
                      setSessionTarget(target)
                      if (target === 'isolated') {
                        setPayloadKind('agentTurn')
                      } else {
                        setPayloadKind('systemEvent')
                        setDeliveryMode('none')
                      }
                    }}
                    className={cn(
                      'px-3 py-1.5 text-xs capitalize',
                      sessionTarget === target ? 'bg-bg-3 text-fg-0' : 'text-fg-2 hover:text-fg-1'
                    )}
                  >
                    {target}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-fg-1 mb-1.5">
              {payloadKind === 'agentTurn' ? 'Agent message' : 'System event text'}
            </label>
            <textarea
              value={payloadText}
              onChange={(e) => setPayloadText(e.target.value)}
              placeholder={payloadKind === 'agentTurn' ? 'What should the agent do?' : 'System event payload text'}
              rows={4}
              disabled={isSubmitting}
              className="w-full px-3 py-2 text-sm font-mono bg-bg-2 border border-bd-1 rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-2 focus:outline-none focus:ring-1 focus:ring-status-info/50 resize-y disabled:opacity-50"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-fg-1 mb-1.5">Wake mode</label>
              <div className="inline-flex rounded-[var(--radius-md)] border border-bd-1 overflow-hidden bg-bg-2">
                {(['now', 'next-heartbeat'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => setWakeMode(mode)}
                    className={cn(
                      'px-3 py-1.5 text-xs',
                      wakeMode === mode ? 'bg-bg-3 text-fg-0' : 'text-fg-2 hover:text-fg-1'
                    )}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-fg-1 mb-1.5">Delivery mode</label>
              <div className="inline-flex rounded-[var(--radius-md)] border border-bd-1 overflow-hidden bg-bg-2">
                {(['none', 'announce', 'webhook'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    disabled={isSubmitting || sessionTarget === 'main'}
                    onClick={() => setDeliveryMode(mode)}
                    className={cn(
                      'px-3 py-1.5 text-xs capitalize',
                      deliveryMode === mode ? 'bg-bg-3 text-fg-0' : 'text-fg-2 hover:text-fg-1',
                      sessionTarget === 'main' && mode !== 'none' && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {deliveryMode !== 'none' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-fg-1 mb-1.5">Delivery channel (optional)</label>
                <input
                  type="text"
                  value={deliveryChannel}
                  onChange={(e) => setDeliveryChannel(e.target.value)}
                  placeholder={deliveryMode === 'webhook' ? 'webhook' : 'telegram'}
                  disabled={isSubmitting}
                  className="w-full px-3 py-2 text-sm bg-bg-2 border border-bd-1 rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-2 focus:outline-none focus:ring-1 focus:ring-status-info/50 disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-fg-1 mb-1.5">Delivery target (optional)</label>
                <input
                  type="text"
                  value={deliveryTo}
                  onChange={(e) => setDeliveryTo(e.target.value)}
                  placeholder="@channel-or-destination"
                  disabled={isSubmitting}
                  className="w-full px-3 py-2 text-sm bg-bg-2 border border-bd-1 rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-2 focus:outline-none focus:ring-1 focus:ring-status-info/50 disabled:opacity-50"
                />
              </div>
              <label className="md:col-span-2 flex items-center gap-2 text-xs text-fg-1">
                <input
                  type="checkbox"
                  checked={deliveryBestEffort}
                  onChange={(e) => setDeliveryBestEffort(e.target.checked)}
                  disabled={isSubmitting}
                  className="rounded border-bd-1"
                />
                Best effort delivery
              </label>
            </div>
          )}

          {/* Enabled Toggle */}
          <div className="flex items-center justify-between">
            <label htmlFor="cron-enabled" className="text-xs font-medium text-fg-1">
              Enable job immediately
            </label>
            <button
              type="button"
              id="cron-enabled"
              onClick={() => setEnabled(!enabled)}
              disabled={isSubmitting}
              className={cn(
                'relative w-10 h-5 rounded-full transition-colors',
                enabled ? 'bg-status-success' : 'bg-bg-3',
                'disabled:opacity-50'
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                  enabled && 'translate-x-5'
                )}
              />
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="text-xs text-status-danger bg-status-danger/10 border border-status-danger/20 rounded-[var(--radius-md)] px-3 py-2">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              variant="secondary"
              size="md"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !canSubmit}
              variant="primary"
              size="md"
            >
              {isSubmitting && <LoadingSpinner size="sm" />}
              {isSubmitting ? 'Creating...' : 'Create Job'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
