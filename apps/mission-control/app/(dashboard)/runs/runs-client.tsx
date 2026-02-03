'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { PageHeader, PageSection, EmptyState } from '@savorg/ui'
import { CanonicalTable, type Column } from '@/components/ui/canonical-table'
import { OperationStatusPill } from '@/components/ui/status-pill'
import { RightDrawer } from '@/components/shell/right-drawer'
import { operationsApi, workOrdersApi, agentsApi } from '@/lib/http'
import type { OperationDTO, WorkOrderDTO, AgentDTO } from '@/lib/repo'
import type { OperationStatus } from '@savorg/core'
import { cn } from '@/lib/utils'
import { TerminalSquare, Loader2, RefreshCw, XCircle, PlayCircle, CheckCircle2 } from 'lucide-react'

// Available status transitions
const STATUS_OPTIONS: { value: OperationStatus; label: string }[] = [
  { value: 'todo', label: 'Todo' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'review', label: 'Review' },
  { value: 'done', label: 'Done' },
  { value: 'rework', label: 'Rework' },
]

export function RunsClient() {
  const [operations, setOperations] = useState<OperationDTO[]>([])
  const [workOrders, setWorkOrders] = useState<WorkOrderDTO[]>([])
  const [agents, setAgents] = useState<AgentDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [statusFilter, setStatusFilter] = useState<string | null>(null)

  // Fetch operations
  const fetchOperations = useCallback(async () => {
    try {
      const result = await operationsApi.list()
      setOperations(result.data)
    } catch (err) {
      console.error('Failed to refresh operations:', err)
    }
  }, [])

  // Fetch all data on mount
  useEffect(() => {
    async function fetchData() {
      try {
        const [opsResult, woResult, agentsResult] = await Promise.all([
          operationsApi.list(),
          workOrdersApi.list(),
          agentsApi.list(),
        ])
        setOperations(opsResult.data)
        setWorkOrders(woResult.data)
        setAgents(agentsResult.data)

        // Optional deep-link: /runs?opId=<operationId>
        const opId = new URLSearchParams(window.location.search).get('opId')
        if (opId) {
          setSelectedId(opId)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load operations')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  // Build lookup maps
  const workOrdersMap = useMemo(
    () => Object.fromEntries(workOrders.map((wo) => [wo.id, wo])),
    [workOrders]
  )
  const agentsMap = useMemo(
    () => Object.fromEntries(agents.map((a) => [a.id, a])),
    [agents]
  )

  const selectedOperation = selectedId
    ? operations.find((op) => op.id === selectedId)
    : undefined

  const filteredOps = statusFilter
    ? operations.filter((op) => op.status === statusFilter)
    : operations

  const inProgressCount = operations.filter((op) => op.status === 'in_progress').length
  const blockedCount = operations.filter((op) => op.status === 'blocked').length

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-fg-2" />
      </div>
    )
  }

  if (error) {
    return (
      <EmptyState
        icon={<TerminalSquare className="w-8 h-8" />}
        title="Error loading operations"
        description={error}
      />
    )
  }

  const operationColumns: Column<OperationDTO>[] = [
    {
      key: 'id',
      header: 'ID',
      width: '70px',
      mono: true,
      render: (row) => <span className="text-fg-2">{row.id.replace('op_', 'OP-')}</span>,
    },
    {
      key: 'title',
      header: 'Title',
      render: (row) => (
        <span className="truncate max-w-[280px] inline-block">{row.title}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '110px',
      render: (row) => <OperationStatusPill status={row.status} />,
    },
    {
      key: 'station',
      header: 'Station',
      width: '80px',
      render: (row) => (
        <span className="px-2 py-0.5 text-xs bg-bg-3 rounded text-fg-1">{row.station}</span>
      ),
    },
    {
      key: 'workOrderId',
      header: 'Work Order',
      width: '90px',
      mono: true,
      render: (row) => {
        const wo = workOrdersMap[row.workOrderId]
        return <span className="text-fg-1">{wo?.code || row.workOrderId}</span>
      },
    },
    {
      key: 'assignee',
      header: 'Assignee',
      width: '100px',
      render: (row) => {
        if (row.assigneeAgentIds.length === 0) {
          return <span className="text-fg-3">Unassigned</span>
        }
        const agent = agentsMap[row.assigneeAgentIds[0]]
        return <span className="text-status-progress font-mono text-xs">{agent?.name || '—'}</span>
      },
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      width: '90px',
      align: 'right',
      render: (row) => (
        <span className="text-fg-2 text-xs">{formatRelativeTime(row.updatedAt)}</span>
      ),
    },
  ]

  return (
    <>
      <div className="w-full space-y-4">
        <PageHeader
          title="Runs"
          subtitle={`${inProgressCount} running, ${blockedCount} blocked`}
          actions={
            <div className="flex items-center gap-2">
              <select
                value={statusFilter || ''}
                onChange={(e) => setStatusFilter(e.target.value || null)}
                className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-bg-3 text-fg-1 border border-white/[0.06] focus:outline-none focus:border-bd-1"
              >
                <option value="">All statuses</option>
                <option value="todo">Todo</option>
                <option value="in_progress">In Progress</option>
                <option value="blocked">Blocked</option>
                <option value="review">Review</option>
                <option value="done">Done</option>
              </select>
            </div>
          }
        />

        <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-white/[0.06] overflow-hidden">
          <CanonicalTable
            columns={operationColumns}
            rows={filteredOps}
            rowKey={(row) => row.id}
            onRowClick={(row) => setSelectedId(row.id)}
            selectedKey={selectedId}
            density="compact"
            emptyState={
              <EmptyState
                icon={<TerminalSquare className="w-8 h-8" />}
                title="No operations"
                description="Operations will appear here when work orders are active"
              />
            }
          />
        </div>
      </div>

      {/* Detail Drawer */}
      <RightDrawer
        open={!!selectedOperation}
        onClose={() => setSelectedId(undefined)}
        title={selectedOperation?.title}
        description={selectedOperation?.station}
      >
        {selectedOperation && (
          <OperationDetail
            operation={selectedOperation}
            workOrder={workOrdersMap[selectedOperation.workOrderId]}
            agentsMap={agentsMap}
            onStatusChange={fetchOperations}
          />
        )}
      </RightDrawer>
    </>
  )
}

function OperationDetail({
  operation,
  workOrder,
  agentsMap,
  onStatusChange,
}: {
  operation: OperationDTO
  workOrder?: WorkOrderDTO
  agentsMap: Record<string, AgentDTO>
  onStatusChange?: () => void
}) {
  const [isUpdating, setIsUpdating] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)

  const assignees = operation.assigneeAgentIds
    .map((id) => agentsMap[id])
    .filter(Boolean)

  // Handle status change
  const handleStatusChange = async (newStatus: string) => {
    setIsUpdating(true)
    setUpdateError(null)
    try {
      await operationsApi.update(operation.id, { status: newStatus })
      onStatusChange?.()
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : 'Failed to update status')
    } finally {
      setIsUpdating(false)
    }
  }

  // Quick actions
  const handleCancel = () => handleStatusChange('blocked')
  const handleRetry = () => handleStatusChange('todo')
  const handleMarkDone = () => handleStatusChange('done')
  const handleStartWork = () => handleStatusChange('in_progress')

  const canRetry = operation.status === 'blocked' || operation.status === 'done' || operation.status === 'rework'
  const canCancel = operation.status !== 'done' && operation.status !== 'blocked'
  const canMarkDone = operation.status !== 'done'
  const canStartWork = operation.status === 'todo' || operation.status === 'rework'

  return (
    <div className="space-y-6">
      {/* Status & Quick Actions */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <OperationStatusPill status={operation.status} />
          <span className="px-2 py-0.5 text-xs bg-bg-3 rounded text-fg-1">{operation.station}</span>
        </div>

        {/* Quick Action Buttons */}
        <div className="flex flex-wrap gap-2">
          {canStartWork && (
            <button
              onClick={handleStartWork}
              disabled={isUpdating}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-status-progress/10 text-status-progress hover:bg-status-progress/20 rounded-[var(--radius-md)] border border-status-progress/20 disabled:opacity-50"
            >
              <PlayCircle className="w-3.5 h-3.5" />
              Start Work
            </button>
          )}
          {canMarkDone && (
            <button
              onClick={handleMarkDone}
              disabled={isUpdating}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-status-success/10 text-status-success hover:bg-status-success/20 rounded-[var(--radius-md)] border border-status-success/20 disabled:opacity-50"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Mark Done
            </button>
          )}
          {canRetry && (
            <button
              onClick={handleRetry}
              disabled={isUpdating}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-status-info/10 text-status-info hover:bg-status-info/20 rounded-[var(--radius-md)] border border-status-info/20 disabled:opacity-50"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry
            </button>
          )}
          {canCancel && (
            <button
              onClick={handleCancel}
              disabled={isUpdating}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-status-danger/10 text-status-danger hover:bg-status-danger/20 rounded-[var(--radius-md)] border border-status-danger/20 disabled:opacity-50"
            >
              <XCircle className="w-3.5 h-3.5" />
              Block
            </button>
          )}
        </div>

        {/* Status Dropdown */}
        <div>
          <label className="block text-xs font-medium text-fg-2 mb-1">Change Status</label>
          <select
            value={operation.status}
            onChange={(e) => handleStatusChange(e.target.value)}
            disabled={isUpdating}
            className="w-full px-3 py-2 text-sm bg-bg-3 border border-white/[0.08] rounded-[var(--radius-md)] text-fg-0 focus:outline-none focus:ring-1 focus:ring-status-info/50 disabled:opacity-50"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Error Message */}
        {updateError && (
          <div className="text-xs text-status-danger bg-status-danger/10 border border-status-danger/20 rounded-[var(--radius-md)] px-3 py-2">
            {updateError}
          </div>
        )}

        {/* Loading Indicator */}
        {isUpdating && (
          <div className="flex items-center gap-2 text-xs text-fg-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Updating status...
          </div>
        )}
      </div>

      {/* Work Order Link */}
      {workOrder && (
        <PageSection title="Work Order">
          <div className="p-3 bg-bg-3 rounded-[var(--radius-md)] border border-white/[0.06]">
            <p className="font-mono text-xs text-fg-2">{workOrder.code}</p>
            <p className="text-sm text-fg-0 mt-1">{workOrder.title}</p>
          </div>
        </PageSection>
      )}

      {/* Blocked Reason */}
      {operation.blockedReason && (
        <PageSection title="Blocked">
          <p className="text-sm text-status-danger">{operation.blockedReason}</p>
        </PageSection>
      )}

      {/* Assignees */}
      <PageSection title="Assignees">
        {assignees.length > 0 ? (
          <div className="space-y-2">
            {assignees.map((agent) => (
              <div
                key={agent.id}
                className="flex items-center justify-between p-2 bg-bg-3 rounded-[var(--radius-md)]"
              >
                <span className="font-mono text-xs text-status-progress">{agent.name}</span>
                <span className="text-xs text-fg-2">{agent.role}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-fg-2">Unassigned</p>
        )}
      </PageSection>

      {/* Dependencies */}
      {operation.dependsOnOperationIds.length > 0 && (
        <PageSection title="Dependencies">
          <div className="space-y-1">
            {operation.dependsOnOperationIds.map((depId) => (
              <p key={depId} className="text-xs font-mono text-fg-2">
                {depId.replace('op_', 'OP-')}
              </p>
            ))}
          </div>
        </PageSection>
      )}

      {/* Metadata */}
      <PageSection title="Details">
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-fg-2">WIP Class</dt>
          <dd className="text-fg-1">{operation.wipClass}</dd>
          <dt className="text-fg-2">Created</dt>
          <dd className="text-fg-1 font-mono text-xs">{new Date(operation.createdAt).toLocaleDateString()}</dd>
          <dt className="text-fg-2">Updated</dt>
          <dd className="text-fg-1 font-mono text-xs">{formatRelativeTime(operation.updatedAt)}</dd>
        </dl>
      </PageSection>
    </div>
  )
}

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
