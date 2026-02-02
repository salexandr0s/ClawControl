'use client'

import { useState, useEffect, useMemo } from 'react'
import { PageHeader, PageSection, EmptyState } from '@savorg/ui'
import { CanonicalTable, type Column } from '@/components/ui/canonical-table'
import { OperationStatusPill } from '@/components/ui/status-pill'
import { RightDrawer } from '@/components/shell/right-drawer'
import { operationsApi, workOrdersApi, agentsApi } from '@/lib/http'
import type { OperationDTO, WorkOrderDTO, AgentDTO } from '@/lib/repo'
import { TerminalSquare, Loader2 } from 'lucide-react'

export function RunsClient() {
  const [operations, setOperations] = useState<OperationDTO[]>([])
  const [workOrders, setWorkOrders] = useState<WorkOrderDTO[]>([])
  const [agents, setAgents] = useState<AgentDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [statusFilter, setStatusFilter] = useState<string | null>(null)

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
}: {
  operation: OperationDTO
  workOrder?: WorkOrderDTO
  agentsMap: Record<string, AgentDTO>
}) {
  const assignees = operation.assigneeAgentIds
    .map((id) => agentsMap[id])
    .filter(Boolean)

  return (
    <div className="space-y-6">
      {/* Status */}
      <div className="flex items-center gap-3">
        <OperationStatusPill status={operation.status} />
        <span className="px-2 py-0.5 text-xs bg-bg-3 rounded text-fg-1">{operation.station}</span>
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
