'use client'

import { useState } from 'react'
import { PageHeader, PageSection, EmptyState, DisabledAction } from '@savorgos/ui'
import { CanonicalTable, type Column } from '@/components/ui/canonical-table'
import { StatusPill } from '@/components/ui/status-pill'
import { RightDrawer } from '@/components/shell/right-drawer'
import type { CronJobDTO } from '@/lib/data'
import { cn } from '@/lib/utils'
import { Clock, Plus, Play, Pause } from 'lucide-react'
import type { StatusTone } from '@savorgos/ui/theme'

interface Props {
  cronJobs: CronJobDTO[]
}

const cronColumns: Column<CronJobDTO>[] = [
  {
    key: 'name',
    header: 'Job',
    width: '140px',
    mono: true,
    render: (row) => (
      <div className="flex items-center gap-2">
        <span className={cn(
          'w-2 h-2 rounded-full',
          row.enabled ? 'bg-status-success' : 'bg-fg-3'
        )} />
        <span className="text-fg-0">{row.name}</span>
      </div>
    ),
  },
  {
    key: 'schedule',
    header: 'Schedule',
    width: '120px',
    mono: true,
    render: (row) => <span className="text-fg-2">{row.schedule}</span>,
  },
  {
    key: 'description',
    header: 'Description',
    render: (row) => (
      <span className="text-fg-1 truncate max-w-[220px] inline-block">{row.description}</span>
    ),
  },
  {
    key: 'lastStatus',
    header: 'Last Run',
    width: '90px',
    render: (row) => {
      if (!row.lastStatus) return <span className="text-fg-3">Never</span>
      const toneMap: Record<string, StatusTone> = {
        success: 'success',
        failed: 'danger',
        running: 'progress',
      }
      return <StatusPill tone={toneMap[row.lastStatus]} label={row.lastStatus} />
    },
  },
  {
    key: 'runCount',
    header: 'Runs',
    width: '60px',
    align: 'center',
    mono: true,
  },
  {
    key: 'nextRunAt',
    header: 'Next Run',
    width: '100px',
    align: 'right',
    render: (row) => (
      <span className="text-fg-2 text-xs">
        {row.nextRunAt ? formatRelativeTime(row.nextRunAt) : '—'}
      </span>
    ),
  },
]

export function CronClient({ cronJobs }: Props) {
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const selectedJob = selectedId ? cronJobs.find((c) => c.id === selectedId) : undefined

  const enabledCount = cronJobs.filter((c) => c.enabled).length

  return (
    <>
      <div className="w-full space-y-4">
        <PageHeader
          title="Cron Jobs"
          subtitle={`${enabledCount} enabled / ${cronJobs.length} total`}
          actions={
            <DisabledAction phase="Phase 4">
              <div className="flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5" />
                Add Job
              </div>
            </DisabledAction>
          }
        />

        <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0 overflow-hidden">
          <CanonicalTable
            columns={cronColumns}
            rows={cronJobs}
            rowKey={(row) => row.id}
            onRowClick={(row) => setSelectedId(row.id)}
            selectedKey={selectedId}
            density="compact"
            emptyState={
              <EmptyState
                icon={<Clock className="w-8 h-8" />}
                title="No cron jobs"
                description="Schedule recurring tasks to automate your workflow"
              />
            }
          />
        </div>
      </div>

      {/* Detail Drawer */}
      <RightDrawer
        open={!!selectedJob}
        onClose={() => setSelectedId(undefined)}
        title={selectedJob?.name}
        description={selectedJob?.description}
      >
        {selectedJob && <CronDetail job={selectedJob} />}
      </RightDrawer>
    </>
  )
}

function CronDetail({ job }: { job: CronJobDTO }) {
  return (
    <div className="p-4 space-y-6">
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
      <PageSection title="Schedule">
        <div className="p-3 bg-bg-3 rounded-[var(--radius-md)] border border-bd-0">
          <code className="font-mono text-sm text-fg-0">{job.schedule}</code>
        </div>
      </PageSection>

      {/* Actions */}
      <PageSection title="Actions">
        <div className="flex gap-2">
          <DisabledAction phase="Phase 4">
            <div className="flex items-center gap-1.5">
              <Play className="w-3.5 h-3.5" />
              Run Now
            </div>
          </DisabledAction>
          <DisabledAction phase="Phase 4">
            <div className="flex items-center gap-1.5">
              {job.enabled ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {job.enabled ? 'Disable' : 'Enable'}
            </div>
          </DisabledAction>
        </div>
      </PageSection>

      {/* Stats */}
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
