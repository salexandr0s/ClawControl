import { getCronJobs, type CronRepoJobDTO, type CronJobDTO } from '@/lib/data'
import { CronClient } from './cron-client'
import { AvailabilityBadge } from '@/components/availability-badge'

/**
 * Parse a cron expression into human-readable text.
 * Supports common patterns like every-30-min or specific-minutes-per-hour.
 */
function parseCronExpr(expr: string, tz?: string): string {
  const parts = expr.split(' ')
  if (parts.length !== 5) return expr

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts
  const tzSuffix = tz ? ` (${tz.split('/').pop()})` : ''

  // Every N minutes: */N * * * *
  if (minute.startsWith('*/') && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
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
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*' && hour !== '*' && minute !== '*') {
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

  // Fallback: show expression
  return expr
}

/**
 * Format a CronSchedule object to a human-readable string.
 */
function formatSchedule(schedule: CronRepoJobDTO['schedule']): string {
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

/**
 * Actual CLI job structure (differs from CronRepoJobDTO type definition).
 */
interface CliCronJob {
  id: string
  name: string
  schedule: CronRepoJobDTO['schedule']
  description?: string
  enabled?: boolean
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

/**
 * Map OpenClaw CLI job to the UI's CronJobDTO format.
 */
function mapToUiDto(job: CliCronJob): CronJobDTO {
  // Handle both nested state (actual CLI) and flat fields (legacy/typed)
  const state = job.state
  const lastRunAtMs = state?.lastRunAtMs
  const nextRunAtMs = state?.nextRunAtMs
  const lastStatus = state?.lastStatus ?? job.lastStatus
  const runCount = state?.runCount ?? job.runCount ?? 0

  // Map CLI status values to UI status values
  const mappedStatus = lastStatus === 'ok' ? 'success' : lastStatus as CronJobDTO['lastStatus']

  return {
    id: job.id,
    name: job.name,
    schedule: formatSchedule(job.schedule),
    description: job.description ?? '',
    enabled: job.enabled ?? true,
    lastRunAt: lastRunAtMs ? new Date(lastRunAtMs) : (job.lastRunAt ? new Date(job.lastRunAt) : null),
    nextRunAt: nextRunAtMs ? new Date(nextRunAtMs) : (job.nextRunAt ? new Date(job.nextRunAt) : null),
    lastStatus: mappedStatus ?? null,
    runCount,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

export default async function CronPage() {
  const response = await getCronJobs()

  // Map OpenClaw DTOs to UI DTOs
  // API returns { jobs: [...] } wrapper, extract the array
  const rawData = response.data
  const jobsArray: CliCronJob[] = Array.isArray(rawData)
    ? rawData
    : (rawData as { jobs?: CliCronJob[] } | null)?.jobs ?? []
  const cronJobs = jobsArray.map(mapToUiDto)

  return (
    <div>
      <div className="mb-4">
        <AvailabilityBadge
          status={response.status}
          latencyMs={response.latencyMs}
          cached={response.cached}
          staleAgeMs={response.staleAgeMs}
          label="Cron"
        />
      </div>

      {response.status === 'unavailable' ? (
        <div className="p-4 bg-status-error/10 rounded-md text-status-error">
          <p className="font-medium">OpenClaw Unavailable</p>
          <p className="text-sm mt-1">{response.error ?? 'Unable to connect to cron scheduler'}</p>
        </div>
      ) : (
        <CronClient cronJobs={cronJobs} />
      )}
    </div>
  )
}
