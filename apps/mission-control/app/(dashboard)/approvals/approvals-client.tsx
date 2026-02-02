'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { PageHeader, PageSection, EmptyState } from '@savorg/ui'
import { CanonicalTable, type Column } from '@/components/ui/canonical-table'
import { StatusPill } from '@/components/ui/status-pill'
import { RightDrawer } from '@/components/shell/right-drawer'
import { approvalsApi } from '@/lib/http'
import type { ApprovalDTO, WorkOrderDTO } from '@/lib/repo'
import type { ApprovalType } from '@savorg/core'
import { cn } from '@/lib/utils'
import {
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  ShieldAlert,
  Ship,
  Loader2,
  ExternalLink,
} from 'lucide-react'

// ============================================================================
// TYPES
// ============================================================================

interface Props {
  approvals: ApprovalDTO[]
  workOrderMap: Record<string, WorkOrderDTO>
}

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected'
type TypeFilter = 'all' | ApprovalType

const APPROVAL_TYPE_LABELS: Record<ApprovalType, string> = {
  ship_gate: 'Ship Gate',
  risky_action: 'Risky Action',
  scope_change: 'Scope Change',
  cron_change: 'Cron Change',
  external_side_effect: 'External Effect',
}

const APPROVAL_TYPE_ICONS: Record<ApprovalType, typeof Ship> = {
  ship_gate: Ship,
  risky_action: ShieldAlert,
  scope_change: AlertTriangle,
  cron_change: Clock,
  external_side_effect: ExternalLink,
}

// ============================================================================
// COLUMNS
// ============================================================================

const createColumns = (
  workOrderMap: Record<string, WorkOrderDTO>,
  onQuickApprove?: (id: string) => void,
  quickApprovingId?: string | null
): Column<ApprovalDTO>[] => [
  {
    key: 'status',
    header: '',
    width: '40px',
    render: (row) => {
      if (row.status === 'approved') return <CheckCircle className="w-4 h-4 text-status-success" />
      if (row.status === 'rejected') return <XCircle className="w-4 h-4 text-status-error" />
      return <Clock className="w-4 h-4 text-status-warning" />
    },
  },
  {
    key: 'type',
    header: 'Type',
    width: '120px',
    render: (row) => {
      const Icon = APPROVAL_TYPE_ICONS[row.type]
      return (
        <div className="flex items-center gap-1.5">
          <Icon className="w-3.5 h-3.5 text-fg-2" />
          <span className="text-xs text-fg-1">{APPROVAL_TYPE_LABELS[row.type]}</span>
        </div>
      )
    },
  },
  {
    key: 'questionMd',
    header: 'Request',
    render: (row) => (
      <span className="text-sm text-fg-0 truncate max-w-[300px] inline-block">
        {row.questionMd}
      </span>
    ),
  },
  {
    key: 'workOrderId',
    header: 'Work Order',
    width: '100px',
    mono: true,
    render: (row) => {
      const wo = workOrderMap[row.workOrderId]
      return (
        <Link
          href={`/work-orders/${row.workOrderId}`}
          className="text-status-info hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {wo?.code ?? row.workOrderId.slice(0, 8)}
        </Link>
      )
    },
  },
  {
    key: 'createdAt',
    header: 'Requested',
    width: '90px',
    align: 'right',
    render: (row) => (
      <span className="text-xs text-fg-2">{formatRelativeTime(row.createdAt)}</span>
    ),
  },
  {
    key: 'actions',
    header: '',
    width: '90px',
    align: 'right',
    render: (row) => {
      // Only show quick approve for pending non-danger approvals
      if (row.status !== 'pending') return null
      if (row.type === 'risky_action') return null // danger requires detail view

      const isApproving = quickApprovingId === row.id

      return (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onQuickApprove?.(row.id)
          }}
          disabled={isApproving}
          className="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-status-success text-white rounded hover:bg-status-success/90 disabled:opacity-50"
        >
          {isApproving ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <CheckCircle className="w-3 h-3" />
          )}
          Approve
        </button>
      )
    },
  },
]

// ============================================================================
// COMPONENT
// ============================================================================

export function ApprovalsClient({ approvals: initialApprovals, workOrderMap }: Props) {
  const [approvals, setApprovals] = useState(initialApprovals)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [quickApprovingId, setQuickApprovingId] = useState<string | null>(null)

  const selectedApproval = selectedId ? approvals.find((a) => a.id === selectedId) : undefined

  // Filter approvals
  const filteredApprovals = useMemo(() => {
    return approvals.filter((a) => {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false
      if (typeFilter !== 'all' && a.type !== typeFilter) return false
      return true
    })
  }, [approvals, statusFilter, typeFilter])

  // Counts
  const counts = useMemo(() => ({
    all: approvals.length,
    pending: approvals.filter((a) => a.status === 'pending').length,
    approved: approvals.filter((a) => a.status === 'approved').length,
    rejected: approvals.filter((a) => a.status === 'rejected').length,
  }), [approvals])

  // Quick approve handler (for non-danger)
  const handleQuickApprove = async (id: string) => {
    setQuickApprovingId(id)
    try {
      const result = await approvalsApi.update(id, { status: 'approved' })
      setApprovals((prev) =>
        prev.map((a) => (a.id === id ? result.data : a))
      )
    } catch (err) {
      console.error('Failed to approve:', err)
    } finally {
      setQuickApprovingId(null)
    }
  }

  const columns = createColumns(workOrderMap, handleQuickApprove, quickApprovingId)

  return (
    <>
      <div className="w-full space-y-4">
        <PageHeader
          title="Approvals"
          subtitle={`${counts.pending} pending`}
        />

        {/* Filters */}
        <div className="flex items-center gap-4">
          {/* Status Filter */}
          <div className="flex items-center gap-1 bg-bg-2 rounded-[var(--radius-md)] p-1">
            {(['all', 'pending', 'approved', 'rejected'] as const).map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-[var(--radius-sm)] transition-colors',
                  statusFilter === status
                    ? 'bg-bg-3 text-fg-0'
                    : 'text-fg-2 hover:text-fg-1'
                )}
              >
                {status === 'all' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1)}
                <span className="ml-1.5 text-fg-3">
                  {counts[status]}
                </span>
              </button>
            ))}
          </div>

          {/* Type Filter */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
            className="px-3 py-1.5 text-xs bg-bg-2 border border-white/[0.06] rounded-[var(--radius-md)] text-fg-1"
          >
            <option value="all">All Types</option>
            {Object.entries(APPROVAL_TYPE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>

        {/* Table */}
        <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-white/[0.06] overflow-hidden">
          <CanonicalTable
            columns={columns}
            rows={filteredApprovals}
            rowKey={(row) => row.id}
            onRowClick={(row) => setSelectedId(row.id)}
            selectedKey={selectedId}
            density="compact"
            emptyState={
              <EmptyState
                icon={<Clock className="w-8 h-8" />}
                title="No approvals"
                description={
                  statusFilter === 'pending'
                    ? 'No pending approvals at this time'
                    : 'No approvals match the current filters'
                }
              />
            }
          />
        </div>
      </div>

      {/* Detail Drawer */}
      <RightDrawer
        open={!!selectedApproval}
        onClose={() => setSelectedId(undefined)}
        title={selectedApproval ? APPROVAL_TYPE_LABELS[selectedApproval.type] : ''}
        description={selectedApproval?.status === 'pending' ? 'Awaiting your decision' : undefined}
      >
        {selectedApproval && (
          <ApprovalDetail
            approval={selectedApproval}
            workOrder={workOrderMap[selectedApproval.workOrderId]}
            onUpdate={(updated) => {
              setApprovals((prev) =>
                prev.map((a) => (a.id === updated.id ? updated : a))
              )
              setSelectedId(undefined)
            }}
          />
        )}
      </RightDrawer>
    </>
  )
}

// ============================================================================
// DETAIL COMPONENT
// ============================================================================

function ApprovalDetail({
  approval,
  workOrder,
  onUpdate,
}: {
  approval: ApprovalDTO
  workOrder?: WorkOrderDTO
  onUpdate: (approval: ApprovalDTO) => void
}) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const isDanger = approval.type === 'risky_action'
  const isPending = approval.status === 'pending'

  const handleResolve = async (status: 'approved' | 'rejected') => {
    // For danger rejections, require a note
    if (isDanger && status === 'rejected' && !note.trim()) {
      setError('A note is required when rejecting danger-level actions')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const result = await approvalsApi.update(approval.id, {
        status,
        note: note.trim() || undefined,
      })
      onUpdate(result.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update approval')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Status */}
      <div className="flex items-center gap-2">
        {approval.status === 'pending' && (
          <StatusPill tone="warning" label="Pending" />
        )}
        {approval.status === 'approved' && (
          <StatusPill tone="success" label="Approved" />
        )}
        {approval.status === 'rejected' && (
          <StatusPill tone="danger" label="Rejected" />
        )}
        {isDanger && (
          <span className="px-2 py-0.5 text-xs bg-status-error/10 text-status-error rounded">
            Danger
          </span>
        )}
      </div>

      {/* Request */}
      <PageSection title="Request">
        <div className="p-3 bg-bg-3 rounded-[var(--radius-md)] border border-white/[0.06]">
          <p className="text-sm text-fg-0">{approval.questionMd}</p>
        </div>
      </PageSection>

      {/* Work Order Link */}
      {workOrder && (
        <PageSection title="Work Order">
          <Link
            href={`/work-orders/${approval.workOrderId}`}
            className="flex items-center gap-2 p-3 bg-bg-3 rounded-[var(--radius-md)] border border-white/[0.06] hover:border-bd-1 transition-colors"
          >
            <span className="font-mono text-sm text-status-info">{workOrder.code}</span>
            <span className="text-sm text-fg-1 truncate">{workOrder.title}</span>
            <ExternalLink className="w-3.5 h-3.5 text-fg-2 ml-auto shrink-0" />
          </Link>
        </PageSection>
      )}

      {/* Policy Info */}
      <PageSection title="Policy">
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-fg-2">Type</dt>
          <dd className="text-fg-1">{APPROVAL_TYPE_LABELS[approval.type]}</dd>
          <dt className="text-fg-2">Risk Level</dt>
          <dd className={cn(
            isDanger ? 'text-status-error' : 'text-status-warning'
          )}>
            {isDanger ? 'Danger' : 'Caution'}
          </dd>
          <dt className="text-fg-2">Requested</dt>
          <dd className="text-fg-1 font-mono text-xs">
            {formatRelativeTime(approval.createdAt)}
          </dd>
          {approval.resolvedAt && (
            <>
              <dt className="text-fg-2">Resolved</dt>
              <dd className="text-fg-1 font-mono text-xs">
                {formatRelativeTime(approval.resolvedAt)}
              </dd>
            </>
          )}
          {approval.resolvedBy && (
            <>
              <dt className="text-fg-2">Resolved By</dt>
              <dd className="text-fg-1">{approval.resolvedBy}</dd>
            </>
          )}
        </dl>
      </PageSection>

      {/* Actions (only for pending) */}
      {isPending && (
        <PageSection title="Decision">
          {/* Note input for danger actions */}
          {isDanger && (
            <div className="mb-4">
              <label className="block text-xs text-fg-2 mb-1.5">
                Note {approval.status === 'pending' && '(required for rejection)'}
              </label>
              <textarea
                value={note}
                onChange={(e) => {
                  setNote(e.target.value)
                  setError(null)
                }}
                placeholder="Add context for your decision..."
                rows={3}
                className="w-full px-3 py-2 text-sm bg-bg-2 border border-white/[0.06] rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-3 focus:outline-none focus:border-bd-1 resize-none"
              />
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-status-error/10 border border-status-error/30 rounded-[var(--radius-md)]">
              <p className="text-xs text-status-error">{error}</p>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleResolve('rejected')}
              disabled={isSubmitting}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-status-error hover:bg-status-error/10 rounded-[var(--radius-md)] disabled:opacity-50"
            >
              <XCircle className="w-4 h-4" />
              Reject
            </button>
            <button
              onClick={() => handleResolve('approved')}
              disabled={isSubmitting}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-status-success text-white hover:bg-status-success/90 rounded-[var(--radius-md)] disabled:opacity-50"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle className="w-4 h-4" />
              )}
              Approve
            </button>
          </div>
        </PageSection>
      )}
    </div>
  )
}

// ============================================================================
// HELPERS
// ============================================================================

function formatRelativeTime(date: Date | string): string {
  const now = new Date()
  const d = typeof date === 'string' ? new Date(date) : date
  const diff = now.getTime() - d.getTime()
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}
