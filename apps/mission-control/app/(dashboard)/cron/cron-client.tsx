'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { PageHeader, PageSection, EmptyState } from '@savorg/ui'
import { CanonicalTable, type Column } from '@/components/ui/canonical-table'
import { StatusPill } from '@/components/ui/status-pill'
import { RightDrawer } from '@/components/shell/right-drawer'
import type { CronJobDTO } from '@/lib/data'
import { cn } from '@/lib/utils'
import { Clock, Plus, Play, Pause, Loader2, Trash2, X } from 'lucide-react'
import type { StatusTone } from '@savorg/ui/theme'

interface Props {
  cronJobs: CronJobDTO[]
}

const cronColumns: Column<CronJobDTO>[] = [
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
    width: '200px',
    render: (row) => <span className="text-fg-0 font-medium">{row.name}</span>,
  },
  {
    key: 'schedule',
    header: 'Schedule',
    width: '140px',
    render: (row) => <span className="text-fg-1">{row.schedule}</span>,
  },
  {
    key: 'lastStatus',
    header: 'Status',
    width: '80px',
    render: (row) => {
      if (!row.lastStatus) return <span className="text-fg-3">—</span>
      const toneMap: Record<string, StatusTone> = {
        success: 'success',
        failed: 'danger',
        running: 'progress',
      }
      return <StatusPill tone={toneMap[row.lastStatus]} label={row.lastStatus} />
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
]

export function CronClient({ cronJobs }: Props) {
  const router = useRouter()
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const selectedJob = selectedId ? cronJobs.find((c) => c.id === selectedId) : undefined

  const enabledCount = cronJobs.filter((c) => c.enabled).length

  const handleJobCreated = () => {
    router.refresh()
    setCreateModalOpen(false)
  }

  const handleJobDeleted = () => {
    router.refresh()
    setSelectedId(undefined)
  }

  return (
    <>
      <div className="w-full space-y-4">
        <PageHeader
          title="Cron Jobs"
          subtitle={`${enabledCount} enabled / ${cronJobs.length} total`}
          actions={
            <button
              onClick={() => setCreateModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-status-info text-bg-0 hover:bg-status-info/90"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Job
            </button>
          }
        />

        <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-white/[0.06] overflow-hidden">
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
        {selectedJob && (
          <CronDetail
            job={selectedJob}
            onClose={() => setSelectedId(undefined)}
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
  onClose,
  onDeleted,
}: {
  job: CronJobDTO
  onClose: () => void
  onDeleted?: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [actionInProgress, setActionInProgress] = useState<'run' | 'toggle' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function handleRunNow() {
    setActionInProgress('run')
    setError(null)

    try {
      const res = await fetch(`/api/openclaw/cron/${job.id}/run`, { method: 'POST' })
      const data = await res.json()

      if (data.status === 'unavailable') {
        setError(data.error ?? 'Failed to run job')
      } else {
        // Refresh the page to show updated state
        startTransition(() => {
          router.refresh()
        })
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
      const res = await fetch(`/api/openclaw/cron/${job.id}/${endpoint}`, { method: 'POST' })
      const data = await res.json()

      if (data.status === 'unavailable') {
        setError(data.error ?? `Failed to ${endpoint} job`)
      } else {
        // Refresh the page to show updated state
        startTransition(() => {
          router.refresh()
        })
        onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${endpoint} job`)
    } finally {
      setActionInProgress(null)
    }
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }

    setActionInProgress('delete')
    setError(null)

    try {
      const res = await fetch(`/api/openclaw/cron/${job.id}/delete`, { method: 'POST' })
      const data = await res.json()

      if (data.status === 'unavailable') {
        setError(data.error ?? 'Failed to delete job')
        setConfirmDelete(false)
      } else {
        onDeleted?.()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete job')
      setConfirmDelete(false)
    } finally {
      setActionInProgress(null)
    }
  }

  const isLoading = actionInProgress !== null || isPending

  return (
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
      <PageSection title="Schedule">
        <div className="p-3 bg-bg-3 rounded-[var(--radius-md)] border border-white/[0.06]">
          <code className="font-mono text-sm text-fg-0">{job.schedule}</code>
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
          <button
            onClick={handleRunNow}
            disabled={isLoading}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors',
              'bg-accent/10 text-accent hover:bg-accent/20',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {actionInProgress === 'run' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            Run Now
          </button>
          <button
            onClick={handleToggleEnabled}
            disabled={isLoading}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors',
              job.enabled
                ? 'bg-status-warning/10 text-status-warning hover:bg-status-warning/20'
                : 'bg-status-success/10 text-status-success hover:bg-status-success/20',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {actionInProgress === 'toggle' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : job.enabled ? (
              <Pause className="w-3.5 h-3.5" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            {job.enabled ? 'Disable' : 'Enable'}
          </button>
          <button
            onClick={handleDelete}
            disabled={isLoading}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors',
              confirmDelete
                ? 'bg-status-danger text-white hover:bg-status-danger/90'
                : 'bg-status-danger/10 text-status-danger hover:bg-status-danger/20',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {actionInProgress === 'delete' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Trash2 className="w-3.5 h-3.5" />
            )}
            {confirmDelete ? 'Confirm Delete' : 'Delete'}
          </button>
        </div>
        {confirmDelete && (
          <p className="mt-2 text-xs text-status-danger">
            Click again to permanently delete this job
          </p>
        )}
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

// ============================================================================
// CREATE CRON JOB MODAL
// ============================================================================

interface CreateCronJobModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void
}

function CreateCronJobModal({ isOpen, onClose, onCreated }: CreateCronJobModalProps) {
  const [name, setName] = useState('')
  const [schedule, setSchedule] = useState('0 * * * *')
  const [command, setCommand] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setName('')
      setSchedule('0 * * * *')
      setCommand('')
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
    if (!name.trim() || !schedule.trim() || !command.trim()) {
      setError('All fields are required')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const response = await fetch('/api/openclaw/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, schedule, command, enabled }),
      })

      const data = await response.json()

      if (data.status === 'unavailable') {
        setError(data.error || 'Failed to create cron job')
      } else {
        onCreated()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create cron job')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={!isSubmitting ? onClose : undefined}
      />

      {/* Modal */}
      <div className="relative bg-bg-1 border border-white/[0.08] rounded-[var(--radius-lg)] shadow-2xl w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
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
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
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
              className="w-full px-3 py-2 text-sm bg-bg-2 border border-white/[0.08] rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-2 focus:outline-none focus:ring-1 focus:ring-status-info/50 disabled:opacity-50"
            />
          </div>

          {/* Schedule */}
          <div>
            <label htmlFor="cron-schedule" className="block text-xs font-medium text-fg-1 mb-1.5">
              Schedule (cron expression)
            </label>
            <input
              id="cron-schedule"
              type="text"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              placeholder="0 * * * *"
              disabled={isSubmitting}
              className="w-full px-3 py-2 text-sm font-mono bg-bg-2 border border-white/[0.08] rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-2 focus:outline-none focus:ring-1 focus:ring-status-info/50 disabled:opacity-50"
            />
            <p className="mt-1 text-xs text-fg-2">
              minute hour day month weekday (e.g., &quot;0 * * * *&quot; = every hour)
            </p>
          </div>

          {/* Command */}
          <div>
            <label htmlFor="cron-command" className="block text-xs font-medium text-fg-1 mb-1.5">
              Command
            </label>
            <textarea
              id="cron-command"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="openclaw run --task cleanup"
              rows={3}
              disabled={isSubmitting}
              className="w-full px-3 py-2 text-sm font-mono bg-bg-2 border border-white/[0.08] rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-2 focus:outline-none focus:ring-1 focus:ring-status-info/50 resize-none disabled:opacity-50"
            />
          </div>

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
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-medium text-fg-1 hover:text-fg-0 bg-bg-3 rounded-[var(--radius-md)] border border-white/[0.06] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim() || !schedule.trim() || !command.trim()}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-bg-0 bg-status-info hover:bg-status-info/90 rounded-[var(--radius-md)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isSubmitting ? 'Creating...' : 'Create Job'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
