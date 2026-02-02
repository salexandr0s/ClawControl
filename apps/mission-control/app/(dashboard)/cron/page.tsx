import { getCronJobs, type CronRepoJobDTO, type CronJobDTO } from '@/lib/data'
import { CronClient } from './cron-client'
import { AvailabilityBadge } from '@/components/availability-badge'

/**
 * Format a CronSchedule object to a display string.
 */
function formatSchedule(schedule: CronRepoJobDTO['schedule']): string {
  switch (schedule.kind) {
    case 'cron':
      return schedule.expr ?? '* * * * *'
    case 'every': {
      if (!schedule.everyMs) return 'every ?'
      const ms = schedule.everyMs
      if (ms < 60000) return `every ${ms / 1000}s`
      if (ms < 3600000) return `every ${ms / 60000}m`
      if (ms < 86400000) return `every ${ms / 3600000}h`
      return `every ${ms / 86400000}d`
    }
    case 'at':
      return schedule.atMs ? new Date(schedule.atMs).toLocaleString() : 'at ?'
    default:
      return 'unknown'
  }
}

/**
 * Map OpenClaw CronRepoJobDTO to the UI's CronJobDTO format.
 */
function mapToUiDto(job: CronRepoJobDTO): CronJobDTO {
  return {
    id: job.id,
    name: job.name,
    schedule: formatSchedule(job.schedule),
    description: job.description ?? '',
    enabled: job.enabled ?? true,
    lastRunAt: job.lastRunAt ? new Date(job.lastRunAt) : null,
    nextRunAt: job.nextRunAt ? new Date(job.nextRunAt) : null,
    lastStatus: job.lastStatus ?? null,
    runCount: job.runCount ?? 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

export default async function CronPage() {
  const response = await getCronJobs()

  // Map OpenClaw DTOs to UI DTOs
  const cronJobs = (response.data ?? []).map(mapToUiDto)

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
