'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import { PageHeader, PageSection, EmptyState } from '@savorg/ui'
import { OperationStatusPill, WorkOrderStatePill, PriorityPill } from '@/components/ui/status-pill'
import { workOrdersApi, operationsApi, activitiesApi, approvalsApi, receiptsApi } from '@/lib/http'
import type { WorkOrderWithOpsDTO, OperationDTO, ActivityDTO, ApprovalDTO, ReceiptDTO } from '@/lib/repo'
import { cn } from '@/lib/utils'
import { useProtectedActionTrigger } from '@/components/protected-action-modal'
import { getValidWorkOrderTransitions, type WorkOrderState } from '@savorg/core'
import {
  ArrowLeft,
  Loader2,
  ClipboardList,
  LayoutList,
  Terminal,
  MessageSquare,
  FileBox,
  Receipt,
  Activity,
  CheckCircle,
  Clock,
  AlertCircle,
  Plus,
  X,
  Ship,
  Ban,
} from 'lucide-react'

// Stations from routing templates
const STATIONS = ['spec', 'build', 'qa', 'ops', 'update', 'ship', 'compound'] as const

type TabId = 'overview' | 'pipeline' | 'operations' | 'messages' | 'artifacts' | 'receipts' | 'activity'

interface Tab {
  id: TabId
  label: string
  icon: typeof ClipboardList
  disabled?: boolean
}

const tabs: Tab[] = [
  { id: 'overview', label: 'Overview', icon: ClipboardList },
  { id: 'pipeline', label: 'Pipeline', icon: LayoutList },
  { id: 'operations', label: 'Operations', icon: Terminal },
  { id: 'messages', label: 'Messages', icon: MessageSquare },
  { id: 'artifacts', label: 'Artifacts', icon: FileBox },
  { id: 'receipts', label: 'Receipts', icon: Receipt },
  { id: 'activity', label: 'Activity', icon: Activity },
]

interface WorkOrderDetailProps {
  workOrderId: string
}

export function WorkOrderDetail({ workOrderId }: WorkOrderDetailProps) {
  const triggerProtectedAction = useProtectedActionTrigger()
  const [workOrder, setWorkOrder] = useState<WorkOrderWithOpsDTO | null>(null)
  const [operations, setOperations] = useState<OperationDTO[]>([])
  const [activities, setActivities] = useState<ActivityDTO[]>([])
  const [approvals, setApprovals] = useState<ApprovalDTO[]>([])
  const [receipts, setReceipts] = useState<ReceiptDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('overview')

  // Fetch work order data
  useEffect(() => {
    async function fetchData() {
      try {
        const [woResult, opsResult, activitiesResult, approvalsResult, receiptsResult] = await Promise.all([
          workOrdersApi.get(workOrderId),
          operationsApi.list({ workOrderId }),
          activitiesApi.list({ entityType: 'work_order', entityId: workOrderId, limit: 50 }),
          approvalsApi.list({ workOrderId, limit: 50 }),
          receiptsApi.list({ workOrderId }),
        ])
        setWorkOrder(woResult.data)
        setOperations(opsResult.data)
        setActivities(activitiesResult.data)
        setApprovals(approvalsResult.data)
        setReceipts(receiptsResult.data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load work order')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [workOrderId])

  // Refresh operations, activities, approvals, and receipts after changes
  const refreshData = async () => {
    try {
      const [opsResult, activitiesResult, approvalsResult, receiptsResult] = await Promise.all([
        operationsApi.list({ workOrderId }),
        activitiesApi.list({ entityType: 'work_order', entityId: workOrderId, limit: 50 }),
        approvalsApi.list({ workOrderId, limit: 50 }),
        receiptsApi.list({ workOrderId }),
      ])
      setOperations(opsResult.data)
      setActivities(activitiesResult.data)
      setApprovals(approvalsResult.data)
      setReceipts(receiptsResult.data)
    } catch (err) {
      console.error('Failed to refresh data:', err)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-fg-2" />
      </div>
    )
  }

  if (error || !workOrder) {
    return (
      <div className="max-w-[1000px] space-y-4">
        <Link
          href="/work-orders"
          className="inline-flex items-center gap-1.5 text-xs text-fg-2 hover:text-fg-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Work Orders
        </Link>
        <EmptyState
          icon={<ClipboardList className="w-8 h-8" />}
          title="Work order not found"
          description={error || 'The requested work order could not be found'}
        />
      </div>
    )
  }

  const pendingApprovals = approvals.filter((a) => a.status === 'pending')

  // Check allowed state transitions
  const allowedTransitions = getValidWorkOrderTransitions(workOrder.state as WorkOrderState)
  const canShip = allowedTransitions.includes('shipped')
  const canCancel = allowedTransitions.includes('cancelled')

  // Handle ship action
  const handleShip = () => {
    if (!workOrder) return
    triggerProtectedAction({
      actionKind: 'work_order.ship',
      actionTitle: 'Ship Work Order',
      actionDescription: `Mark ${workOrder.code} as shipped. This will finalize the work order and record it in the activity log.`,
      workOrderCode: workOrder.code,
      entityName: workOrder.title,
      onConfirm: async (typedConfirmText: string) => {
        await workOrdersApi.update(workOrderId, { state: 'shipped', typedConfirmText })
        setWorkOrder((prev) => prev ? { ...prev, state: 'shipped', shippedAt: new Date() } : null)
        await refreshData()
      },
      onError: (err) => console.error('Failed to ship work order:', err),
    })
  }

  // Handle cancel action
  const handleCancel = () => {
    if (!workOrder) return
    triggerProtectedAction({
      actionKind: 'work_order.cancel',
      actionTitle: 'Cancel Work Order',
      actionDescription: `Cancel ${workOrder.code}. This action cannot be undone.`,
      workOrderCode: workOrder.code,
      entityName: workOrder.title,
      onConfirm: async (typedConfirmText: string) => {
        await workOrdersApi.update(workOrderId, { state: 'cancelled', typedConfirmText })
        setWorkOrder((prev) => prev ? { ...prev, state: 'cancelled' } : null)
        await refreshData()
      },
      onError: (err) => console.error('Failed to cancel work order:', err),
    })
  }

  return (
    <div className="max-w-[1200px] space-y-4">
      {/* Breadcrumb */}
      <Link
        href="/work-orders"
        className="inline-flex items-center gap-1.5 text-xs text-fg-2 hover:text-fg-1"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to Work Orders
      </Link>

      {/* Header */}
      <PageHeader
        title={workOrder.code}
        subtitle={workOrder.title}
        actions={
          <div className="flex items-center gap-3">
            {/* Action Buttons */}
            <div className="flex items-center gap-2">
              {canShip && (
                <button
                  onClick={handleShip}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-status-success text-white hover:bg-status-success/90"
                >
                  <Ship className="w-3.5 h-3.5" />
                  Ship
                </button>
              )}
              {canCancel && (
                <button
                  onClick={handleCancel}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-status-warning text-black hover:bg-status-warning/90"
                >
                  <Ban className="w-3.5 h-3.5" />
                  Cancel
                </button>
              )}
            </div>
            {/* Status Pills */}
            <div className="flex items-center gap-2">
              <WorkOrderStatePill state={workOrder.state} />
              <PriorityPill priority={workOrder.priority} />
            </div>
          </div>
        }
      />

      {/* Pending Approvals Banner */}
      {pendingApprovals.length > 0 && (
        <div className="flex items-center gap-3 p-3 bg-status-warning/10 border border-status-warning/30 rounded-[var(--radius-md)]">
          <AlertCircle className="w-4 h-4 text-status-warning shrink-0" />
          <span className="text-sm text-fg-0">
            {pendingApprovals.length} pending approval{pendingApprovals.length > 1 ? 's' : ''} require your attention
          </span>
          <button
            onClick={() => setActiveTab('overview')}
            className="ml-auto text-xs font-medium text-status-warning hover:text-status-warning/80"
          >
            View
          </button>
        </div>
      )}

      {/* Tab Bar */}
      <div className="flex border-b border-white/[0.06] overflow-x-auto scrollbar-hide">
        {tabs.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => !tab.disabled && setActiveTab(tab.id)}
              disabled={tab.disabled}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors relative whitespace-nowrap',
                activeTab === tab.id
                  ? 'text-fg-0'
                  : tab.disabled
                    ? 'text-fg-3 cursor-not-allowed'
                    : 'text-fg-2 hover:text-fg-1'
              )}
              title={tab.disabled ? 'Available in Phase 3' : undefined}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
              {tab.id === 'operations' && operations.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-bg-3 rounded-full">
                  {operations.length}
                </span>
              )}
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-status-info" />
              )}
            </button>
          )
        })}
      </div>

      {/* Tab Content */}
      <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-white/[0.06] overflow-hidden">
        {activeTab === 'overview' && (
          <OverviewTab
            workOrder={workOrder}
            operations={operations}
            approvals={pendingApprovals}
            onApprovalResolved={refreshData}
          />
        )}
        {activeTab === 'pipeline' && (
          <PipelineTab workOrder={workOrder} operations={operations} />
        )}
        {activeTab === 'operations' && (
          <OperationsTab
            operations={operations}
            workOrderId={workOrderId}
            onOperationCreated={refreshData}
          />
        )}
        {activeTab === 'messages' && (
          <MessagesTab workOrderId={workOrderId} />
        )}
        {activeTab === 'artifacts' && (
          <ArtifactsTab workOrderId={workOrderId} />
        )}
        {activeTab === 'receipts' && (
          <ReceiptsTab receipts={receipts} workOrderId={workOrderId} />
        )}
        {activeTab === 'activity' && (
          <ActivityTab activities={activities} workOrderId={workOrderId} />
        )}
      </div>
    </div>
  )
}

// ============================================================================
// TAB COMPONENTS
// ============================================================================

function OverviewTab({
  workOrder,
  operations,
  approvals,
  onApprovalResolved,
}: {
  workOrder: WorkOrderWithOpsDTO
  operations: OperationDTO[]
  approvals: ApprovalDTO[]
  onApprovalResolved?: () => void
}) {
  const [resolvingId, setResolvingId] = useState<string | null>(null)

  const handleApproval = async (approvalId: string, status: 'approved' | 'rejected') => {
    setResolvingId(approvalId)
    try {
      await approvalsApi.update(approvalId, { status })
      onApprovalResolved?.()
    } catch (err) {
      console.error('Failed to resolve approval:', err)
    } finally {
      setResolvingId(null)
    }
  }

  const doneOps = operations.filter((op) => op.status === 'done').length
  const totalOps = operations.length
  const progressPercent = totalOps > 0 ? Math.round((doneOps / totalOps) * 100) : 0

  return (
    <div className="p-6 space-y-6">
      {/* Status Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Progress */}
        <div className="p-4 bg-bg-3/50 rounded-[var(--radius-md)] border border-white/[0.06]/50">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-4 h-4 text-status-success" />
            <span className="text-xs font-medium text-fg-1">Progress</span>
          </div>
          <div className="text-2xl font-semibold text-fg-0">{progressPercent}%</div>
          <div className="text-xs text-fg-2 mt-1">
            {doneOps} of {totalOps} operations complete
          </div>
          <div className="mt-2 h-1.5 bg-bg-2 rounded-full overflow-hidden">
            <div
              className="h-full bg-status-success transition-all"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Owner */}
        <div className="p-4 bg-bg-3/50 rounded-[var(--radius-md)] border border-white/[0.06]/50">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-fg-2" />
            <span className="text-xs font-medium text-fg-1">Owner</span>
          </div>
          <div className={cn(
            'text-lg font-semibold',
            workOrder.owner === 'savorgceo' ? 'text-status-progress' : 'text-fg-0'
          )}>
            {workOrder.owner === 'savorgceo' ? 'savorgCEO' : 'User'}
          </div>
          <div className="text-xs text-fg-2 mt-1">
            Created {formatRelativeTime(workOrder.createdAt)}
          </div>
        </div>

        {/* Pending Approvals */}
        <div className="p-4 bg-bg-3/50 rounded-[var(--radius-md)] border border-white/[0.06]/50">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className={cn(
              'w-4 h-4',
              approvals.length > 0 ? 'text-status-warning' : 'text-fg-2'
            )} />
            <span className="text-xs font-medium text-fg-1">Approvals</span>
          </div>
          <div className={cn(
            'text-2xl font-semibold',
            approvals.length > 0 ? 'text-status-warning' : 'text-fg-0'
          )}>
            {approvals.length}
          </div>
          <div className="text-xs text-fg-2 mt-1">
            {approvals.length > 0 ? 'Pending review' : 'No pending approvals'}
          </div>
        </div>
      </div>

      {/* Blocked Reason */}
      {workOrder.blockedReason && (
        <div className="p-4 bg-status-danger/10 border border-status-danger/30 rounded-[var(--radius-md)]">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-4 h-4 text-status-danger" />
            <span className="text-sm font-medium text-status-danger">Blocked</span>
          </div>
          <p className="text-sm text-fg-1">{workOrder.blockedReason}</p>
        </div>
      )}

      {/* Goal (Markdown) */}
      <PageSection title="Goal">
        <div className="prose prose-sm prose-invert max-w-none">
          <ReactMarkdown
            components={{
              p: ({ children }) => <p className="text-sm text-fg-1 mb-3 last:mb-0">{children}</p>,
              ul: ({ children }) => <ul className="text-sm text-fg-1 list-disc pl-4 mb-3 space-y-1">{children}</ul>,
              ol: ({ children }) => <ol className="text-sm text-fg-1 list-decimal pl-4 mb-3 space-y-1">{children}</ol>,
              li: ({ children }) => <li className="text-fg-1">{children}</li>,
              h1: ({ children }) => <h3 className="text-base font-semibold text-fg-0 mt-4 mb-2">{children}</h3>,
              h2: ({ children }) => <h4 className="text-sm font-semibold text-fg-0 mt-3 mb-2">{children}</h4>,
              h3: ({ children }) => <h5 className="text-sm font-medium text-fg-0 mt-2 mb-1">{children}</h5>,
              code: ({ children }) => (
                <code className="px-1 py-0.5 bg-bg-3 rounded text-xs font-mono text-fg-1">{children}</code>
              ),
              pre: ({ children }) => (
                <pre className="p-3 bg-bg-3 rounded-[var(--radius-md)] overflow-x-auto text-xs font-mono text-fg-1 mb-3">
                  {children}
                </pre>
              ),
              a: ({ href, children }) => (
                <a href={href} className="text-status-info hover:underline" target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              ),
              strong: ({ children }) => <strong className="font-semibold text-fg-0">{children}</strong>,
              em: ({ children }) => <em className="italic text-fg-1">{children}</em>,
              blockquote: ({ children }) => (
                <blockquote className="border-l-2 border-bd-1 pl-3 text-fg-2 italic mb-3">{children}</blockquote>
              ),
            }}
          >
            {workOrder.goalMd}
          </ReactMarkdown>
        </div>
      </PageSection>

      {/* Pending Approvals List */}
      {approvals.length > 0 && (
        <PageSection title="Pending Approvals">
          <div className="space-y-2">
            {approvals.map((approval) => {
              const isResolving = resolvingId === approval.id
              return (
                <div
                  key={approval.id}
                  className="flex items-start gap-3 p-3 bg-bg-3/50 rounded-[var(--radius-md)] border border-white/[0.06]/50"
                >
                  <AlertCircle className="w-4 h-4 text-status-warning mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-fg-0">{approval.questionMd}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-fg-2">{approval.type.replace(/_/g, ' ')}</span>
                      <span className="text-fg-3">•</span>
                      <span className="text-xs text-fg-2">{formatRelativeTime(approval.createdAt)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleApproval(approval.id, 'rejected')}
                      disabled={isResolving}
                      className="px-2.5 py-1 text-xs font-medium text-status-danger hover:bg-status-danger/10 rounded-[var(--radius-sm)] disabled:opacity-50"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => handleApproval(approval.id, 'approved')}
                      disabled={isResolving}
                      className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-status-success text-bg-0 hover:bg-status-success/90 rounded-[var(--radius-sm)] disabled:opacity-50"
                    >
                      {isResolving && <Loader2 className="w-3 h-3 animate-spin" />}
                      Approve
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </PageSection>
      )}

      {/* Details */}
      <PageSection title="Details">
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <dt className="text-fg-2 mb-1">Routing Template</dt>
            <dd className="text-fg-1 font-mono text-xs">{workOrder.routingTemplate}</dd>
          </div>
          <div>
            <dt className="text-fg-2 mb-1">Created</dt>
            <dd className="text-fg-1 font-mono text-xs">{new Date(workOrder.createdAt).toLocaleDateString()}</dd>
          </div>
          <div>
            <dt className="text-fg-2 mb-1">Updated</dt>
            <dd className="text-fg-1 font-mono text-xs">{formatRelativeTime(workOrder.updatedAt)}</dd>
          </div>
          {workOrder.shippedAt && (
            <div>
              <dt className="text-fg-2 mb-1">Shipped</dt>
              <dd className="text-fg-1 font-mono text-xs">{new Date(workOrder.shippedAt).toLocaleDateString()}</dd>
            </div>
          )}
        </dl>
      </PageSection>
    </div>
  )
}

function PipelineTab({
  workOrder,
  operations,
}: {
  workOrder: WorkOrderWithOpsDTO
  operations: OperationDTO[]
}) {
  // Parse routing template to get stages
  const stages = workOrder.routingTemplate.split('→').map((s) => s.trim())

  // Group operations by station
  const opsByStation = operations.reduce((acc, op) => {
    if (!acc[op.station]) acc[op.station] = []
    acc[op.station].push(op)
    return acc
  }, {} as Record<string, OperationDTO[]>)

  return (
    <div className="p-6">
      <PageSection
        title="Pipeline"
        description={`Routing: ${workOrder.routingTemplate}`}
      >
        <div className="flex gap-4 overflow-x-auto pb-2">
          {stages.map((stage, index) => {
            const stageOps = opsByStation[stage] || []
            const doneCount = stageOps.filter((op) => op.status === 'done').length
            const inProgressCount = stageOps.filter((op) => op.status === 'in_progress').length
            const blockedCount = stageOps.filter((op) => op.status === 'blocked').length

            return (
              <div
                key={stage}
                className={cn(
                  'flex-shrink-0 w-48 p-4 rounded-[var(--radius-md)] border',
                  stageOps.length === 0
                    ? 'bg-bg-3/30 border-white/[0.03]'
                    : 'bg-bg-3/50 border-white/[0.06]'
                )}
              >
                {/* Stage Header */}
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-fg-1">{stage}</span>
                  <span className="text-[10px] text-fg-3">
                    {index + 1}/{stages.length}
                  </span>
                </div>

                {/* Stats */}
                {stageOps.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-status-success" />
                      <span className="text-xs text-fg-2">{doneCount} done</span>
                    </div>
                    {inProgressCount > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-status-progress" />
                        <span className="text-xs text-fg-2">{inProgressCount} in progress</span>
                      </div>
                    )}
                    {blockedCount > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-status-danger" />
                        <span className="text-xs text-fg-2">{blockedCount} blocked</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-fg-3">No operations</p>
                )}

                {/* Connector */}
                {index < stages.length - 1 && (
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 text-fg-3">
                    →
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </PageSection>
    </div>
  )
}

function OperationsTab({
  operations,
  workOrderId,
  onOperationCreated,
}: {
  operations: OperationDTO[]
  workOrderId: string
  onOperationCreated?: () => void
}) {
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [station, setStation] = useState<string>('build')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    setCreating(true)
    setError(null)

    try {
      await operationsApi.create({
        workOrderId,
        station,
        title: title.trim(),
        notes: notes.trim() || undefined,
      })
      setTitle('')
      setStation('build')
      setNotes('')
      setShowCreate(false)
      onOperationCreated?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create operation')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="p-6">
      <PageSection
        title="Operations"
        description={`${operations.length} total`}
        actions={
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-status-info text-bg-0 hover:bg-status-info/90"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Operation
          </button>
        }
      >
        {operations.length > 0 ? (
          <div className="space-y-2">
            {operations.map((op) => (
              <div
                key={op.id}
                className="flex items-start gap-3 p-4 bg-bg-3/50 rounded-[var(--radius-md)] border border-white/[0.03] hover:border-white/[0.06] transition-colors"
              >
                {/* Status */}
                <OperationStatusPill status={op.status} />

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-fg-0 truncate">{op.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="px-2 py-0.5 text-xs bg-bg-2 rounded text-fg-1">{op.station}</span>
                    {op.assigneeAgentIds.length > 0 && (
                      <>
                        <span className="text-fg-3">•</span>
                        <span className="text-xs text-status-progress font-mono">
                          {op.assigneeAgentIds.length} assignee{op.assigneeAgentIds.length > 1 ? 's' : ''}
                        </span>
                      </>
                    )}
                    {op.blockedReason && (
                      <>
                        <span className="text-fg-3">•</span>
                        <span className="text-xs text-status-danger">{op.blockedReason}</span>
                      </>
                    )}
                  </div>
                  {op.notes && (
                    <p className="text-xs text-fg-2 mt-2 line-clamp-2">{op.notes}</p>
                  )}
                </div>

                {/* Timestamp */}
                <span className="text-xs text-fg-2 shrink-0">
                  {formatRelativeTime(op.updatedAt)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Terminal className="w-8 h-8" />}
            title="No operations yet"
            description="Click 'Add Operation' to create the first operation"
          />
        )}
      </PageSection>

      {/* Create Operation Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-bg-0/80 backdrop-blur-sm"
            onClick={() => setShowCreate(false)}
          />

          {/* Dialog */}
          <div className="relative w-full max-w-md mx-4 bg-bg-1 rounded-[var(--radius-lg)] border border-white/[0.06] shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-white/[0.06]">
              <h3 className="text-sm font-semibold text-fg-0">New Operation</h3>
              <button
                onClick={() => setShowCreate(false)}
                className="p-1.5 rounded-[var(--radius-sm)] text-fg-2 hover:text-fg-0 hover:bg-bg-3"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleCreate} className="p-4 space-y-4">
              {error && (
                <div className="p-3 bg-status-danger/10 border border-status-danger/30 rounded-[var(--radius-md)]">
                  <p className="text-xs text-status-danger">{error}</p>
                </div>
              )}

              {/* Title */}
              <div>
                <label className="block text-xs font-medium text-fg-1 mb-1.5">
                  Title <span className="text-status-danger">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Implement authentication flow"
                  className="w-full px-3 py-2 text-sm bg-bg-2 border border-white/[0.06] rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-3 focus:outline-none focus:border-bd-1"
                  autoFocus
                />
              </div>

              {/* Station */}
              <div>
                <label className="block text-xs font-medium text-fg-1 mb-1.5">
                  Station
                </label>
                <select
                  value={station}
                  onChange={(e) => setStation(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-bg-2 border border-white/[0.06] rounded-[var(--radius-md)] text-fg-0 focus:outline-none focus:border-bd-1"
                >
                  {STATIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-medium text-fg-1 mb-1.5">
                  Notes (optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Additional context or instructions..."
                  rows={3}
                  className="w-full px-3 py-2 text-sm bg-bg-2 border border-white/[0.06] rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-3 focus:outline-none focus:border-bd-1 resize-none"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="px-3 py-1.5 text-xs font-medium text-fg-1 hover:text-fg-0"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!title.trim() || creating}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-status-info text-bg-0 hover:bg-status-info/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {creating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Create Operation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function ActivityTab({
  activities,
  workOrderId: _workOrderId,
}: {
  activities: ActivityDTO[]
  workOrderId: string
}) {
  const typeIcons: Record<string, typeof Activity> = {
    work_order: ClipboardList,
    operation: Terminal,
    approval: AlertCircle,
    system: Activity,
  }

  return (
    <div className="p-6">
      <PageSection
        title="Activity"
        description="Recent activity for this work order"
      >
        {activities.length > 0 ? (
          <div className="space-y-0.5">
            {activities.map((activity) => {
              const typeKey = activity.type.split('.')[0]
              const Icon = typeIcons[typeKey] || Activity

              return (
                <div
                  key={activity.id}
                  className="flex items-start gap-3 py-3 border-b border-white/[0.06]/30 last:border-0"
                >
                  {/* Icon */}
                  <div className={cn(
                    'p-1.5 rounded-[var(--radius-sm)] shrink-0',
                    typeKey === 'work_order' && 'bg-status-progress/10 text-status-progress',
                    typeKey === 'operation' && 'bg-status-info/10 text-status-info',
                    typeKey === 'approval' && 'bg-status-warning/10 text-status-warning',
                    typeKey === 'system' && 'bg-fg-3/10 text-fg-2'
                  )}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-fg-0">{activity.summary}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-fg-2">{activity.type}</span>
                      {activity.actor !== 'system' && (
                        <>
                          <span className="text-fg-3">•</span>
                          <span className="text-xs text-status-progress font-mono">
                            {activity.actor.replace('agent:', '')}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Timestamp */}
                  <span className="text-xs text-fg-2 shrink-0">
                    {formatRelativeTime(activity.ts)}
                  </span>
                </div>
              )
            })}
          </div>
        ) : (
          <EmptyState
            icon={<Activity className="w-8 h-8" />}
            title="No activity yet"
            description="Activity will appear here as the work order progresses"
          />
        )}
      </PageSection>
    </div>
  )
}

function MessagesTab({ workOrderId: _workOrderId }: { workOrderId: string }) {
  return (
    <div className="p-6">
      <PageSection
        title="Messages"
        description="Communication thread for this work order"
      >
        <EmptyState
          icon={<MessageSquare className="w-8 h-8" />}
          title="No messages yet"
          description="Messages between agents and operations will appear here"
        />
      </PageSection>
    </div>
  )
}

function ArtifactsTab({ workOrderId: _workOrderId }: { workOrderId: string }) {
  return (
    <div className="p-6">
      <PageSection
        title="Artifacts"
        description="Files, PRs, and links produced by this work order"
      >
        <EmptyState
          icon={<FileBox className="w-8 h-8" />}
          title="No artifacts yet"
          description="Artifacts like PRs, docs, and files will appear here as work progresses"
        />
      </PageSection>
    </div>
  )
}

function ReceiptsTab({
  receipts,
  workOrderId: _workOrderId,
}: {
  receipts: ReceiptDTO[]
  workOrderId: string
}) {
  return (
    <div className="p-6">
      <PageSection
        title="Receipts"
        description={`${receipts.length} execution records`}
      >
        {receipts.length > 0 ? (
          <div className="space-y-2">
            {receipts.map((receipt) => {
              const isRunning = !receipt.endedAt
              const isSuccess = receipt.exitCode === 0
              const isFailed = receipt.exitCode !== null && receipt.exitCode !== 0

              return (
                <div
                  key={receipt.id}
                  className="flex items-start gap-3 p-4 bg-bg-3/50 rounded-[var(--radius-md)] border border-white/[0.03] hover:border-white/[0.06] transition-colors"
                >
                  {/* Status Indicator */}
                  <div className={cn(
                    'w-2 h-2 mt-1.5 rounded-full shrink-0',
                    isRunning && 'bg-status-progress animate-pulse',
                    isSuccess && 'bg-status-success',
                    isFailed && 'bg-status-danger'
                  )} />

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono font-medium text-fg-0">
                        {receipt.commandName}
                      </span>
                      <span className={cn(
                        'px-1.5 py-0.5 text-[10px] rounded',
                        receipt.kind === 'cron_run' && 'bg-status-info/10 text-status-info',
                        receipt.kind === 'agent_run' && 'bg-status-progress/10 text-status-progress',
                        receipt.kind === 'playbook_step' && 'bg-status-warning/10 text-status-warning',
                        receipt.kind === 'manual' && 'bg-fg-3/10 text-fg-2'
                      )}>
                        {receipt.kind.replace(/_/g, ' ')}
                      </span>
                    </div>

                    {/* Meta */}
                    <div className="flex items-center gap-2 mt-1 text-xs text-fg-2">
                      <span>{formatRelativeTime(receipt.startedAt)}</span>
                      {receipt.durationMs && (
                        <>
                          <span className="text-fg-3">•</span>
                          <span>{receipt.durationMs}ms</span>
                        </>
                      )}
                      {receipt.exitCode !== null && (
                        <>
                          <span className="text-fg-3">•</span>
                          <span className={cn(
                            isSuccess ? 'text-status-success' : 'text-status-danger'
                          )}>
                            exit {receipt.exitCode}
                          </span>
                        </>
                      )}
                    </div>

                    {/* Output Preview */}
                    {receipt.stdoutExcerpt && (
                      <div className="mt-2 p-2 bg-bg-2 rounded text-xs font-mono text-fg-1 max-h-20 overflow-hidden">
                        {receipt.stdoutExcerpt.slice(0, 200)}
                        {receipt.stdoutExcerpt.length > 200 && '...'}
                      </div>
                    )}

                    {/* Error Preview */}
                    {receipt.stderrExcerpt && (
                      <div className="mt-2 p-2 bg-status-danger/10 border border-status-danger/20 rounded text-xs font-mono text-status-danger max-h-20 overflow-hidden">
                        {receipt.stderrExcerpt.slice(0, 200)}
                        {receipt.stderrExcerpt.length > 200 && '...'}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <EmptyState
            icon={<Receipt className="w-8 h-8" />}
            title="No receipts yet"
            description="Execution receipts from commands, cron jobs, and agent runs will appear here"
          />
        )}
      </PageSection>
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
