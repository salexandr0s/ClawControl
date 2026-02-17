'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import { PageHeader, PageSection, EmptyState, Button } from '@clawcontrol/ui'
import { OperationStatusPill, WorkOrderStatePill, PriorityPill } from '@/components/ui/status-pill'
import { LoadingSpinner, LoadingState } from '@/components/ui/loading-state'
import { workOrdersApi, operationsApi, activitiesApi, approvalsApi, receiptsApi, agentsApi } from '@/lib/http'
import type { WorkOrderWithOpsDTO, OperationDTO, ActivityDTO, ApprovalDTO, ReceiptDTO } from '@/lib/repo'
import { cn } from '@/lib/utils'
import { useProtectedActionTrigger } from '@/components/protected-action-modal'
import { StationIcon } from '@/components/station-icon'
import { DispatchErrorCard } from '@/components/work-orders/dispatch-error-card'
import { getValidWorkOrderTransitions, type WorkOrderState } from '@clawcontrol/core'
import { formatOwnerLabel, ownerTextTone } from '@/lib/agent-identity'
import {
  ArrowLeft,
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
  Play,
  Ship,
  Ban,
  Archive,
} from 'lucide-react'

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

function parseTagsInput(input: string): string[] {
  if (!input.trim()) return []
  const normalized = input
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
  return Array.from(new Set(normalized)).slice(0, 20)
}

function getOwnerTextClass(owner: string, ownerType?: string): string {
  return ownerTextTone(owner, ownerType) === 'user' ? 'text-fg-0' : 'text-status-progress'
}

interface WorkOrderDetailProps {
  workOrderId: string
}

export function WorkOrderDetail({ workOrderId }: WorkOrderDetailProps) {
  const triggerProtectedAction = useProtectedActionTrigger()
  const [workOrder, setWorkOrder] = useState<WorkOrderWithOpsDTO | null>(null)
  const [workflowStages, setWorkflowStages] = useState<Array<{ ref: string; agent: string }>>([])
  const [operations, setOperations] = useState<OperationDTO[]>([])
  const [activities, setActivities] = useState<ActivityDTO[]>([])
  const [agentStationsById, setAgentStationsById] = useState<Record<string, string>>({})
  const [approvals, setApprovals] = useState<ApprovalDTO[]>([])
  const [receipts, setReceipts] = useState<ReceiptDTO[]>([])
  const [starting, setStarting] = useState(false)
  const [startFeedback, setStartFeedback] = useState<{
    status: 'running' | 'success' | 'error'
    message: string
  } | null>(null)
  const [actionFeedback, setActionFeedback] = useState<{
    status: 'success' | 'error'
    message: string
  } | null>(null)
  const [stateMutation, setStateMutation] = useState<WorkOrderState | null>(null)
  const [tagInput, setTagInput] = useState('')
  const [savingTags, setSavingTags] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('overview')

  // Fetch work order data
  useEffect(() => {
    async function fetchData() {
      try {
        const [woResult, opsResult, activitiesResult, approvalsResult, receiptsResult, agentsResult] = await Promise.all([
          workOrdersApi.get(workOrderId),
          operationsApi.list({ workOrderId }),
          activitiesApi.list({ entityType: 'work_order', entityId: workOrderId, limit: 50 }),
          approvalsApi.list({ workOrderId, limit: 50 }),
          receiptsApi.list({ workOrderId }),
          agentsApi.list(),
        ])
        setWorkOrder(woResult.data)
        const workflowResponse = await fetch('/api/workflows', {
          method: 'GET',
          headers: { Accept: 'application/json' },
        })
        const workflowJson = (await workflowResponse.json()) as {
          data?: Array<{ id: string; stages?: Array<{ ref: string; agent: string }> }>
        }
        const selectedWorkflow = (workflowJson.data ?? []).find(
          (workflow) => workflow.id === woResult.data.workflowId
        )
        setWorkflowStages(selectedWorkflow?.stages ?? [])
        setTagInput(woResult.data.tags.join(', '))
        setOperations(opsResult.data)
        setActivities(activitiesResult.data)
        setApprovals(approvalsResult.data)
        setReceipts(receiptsResult.data)
        setAgentStationsById(Object.fromEntries(agentsResult.data.map((a) => [a.id, a.station])))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load work order')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [workOrderId])

  useEffect(() => {
    if (workOrder) {
      setTagInput(workOrder.tags.join(', '))
    }
  }, [workOrder?.id, workOrder?.tags])

  // Refresh operations, activities, approvals, and receipts after changes
  const refreshData = async () => {
    try {
      const [opsResult, activitiesResult, approvalsResult, receiptsResult, agentsResult] = await Promise.all([
        operationsApi.list({ workOrderId }),
        activitiesApi.list({ entityType: 'work_order', entityId: workOrderId, limit: 50 }),
        approvalsApi.list({ workOrderId, limit: 50 }),
        receiptsApi.list({ workOrderId }),
        agentsApi.list(),
      ])
      setOperations(opsResult.data)
      setActivities(activitiesResult.data)
      setApprovals(approvalsResult.data)
      setReceipts(receiptsResult.data)
      setAgentStationsById(Object.fromEntries(agentsResult.data.map((a) => [a.id, a.station])))
    } catch (err) {
      console.error('Failed to refresh data:', err)
    }
  }

  const refreshWorkOrderAndOperations = async () => {
    const [woResult, opsResult] = await Promise.all([
      workOrdersApi.get(workOrderId),
      operationsApi.list({ workOrderId }),
    ])
    setWorkOrder(woResult.data)
    setOperations(opsResult.data)
  }

  if (loading) {
    return <LoadingState height="viewport" />
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
  const canArchive = allowedTransitions.includes('archived')

  // Handle ship action
  const handleShip = () => {
    if (!workOrder) return
    setActionFeedback(null)
    setStateMutation('shipped')
    triggerProtectedAction({
      actionKind: 'work_order.ship',
      actionTitle: 'Ship Work Order',
      actionDescription: `Mark ${workOrder.code} as shipped. This will finalize the work order and record it in the activity log.`,
      workOrderCode: workOrder.code,
      entityName: workOrder.title,
      onConfirm: async (typedConfirmText: string) => {
        await workOrdersApi.update(workOrderId, { state: 'shipped', typedConfirmText })
        await refreshWorkOrderAndOperations()
        setActionFeedback({
          status: 'success',
          message: 'Work order shipped successfully.',
        })
        await refreshData()
        setStateMutation(null)
      },
      onError: async (err) => {
        const message = err instanceof Error ? err.message : 'Failed to ship work order'
        setActionFeedback({
          status: 'error',
          message: `Ship failed: ${message}`,
        })
        try {
          await refreshWorkOrderAndOperations()
          await refreshData()
        } catch (refreshErr) {
          console.error('Failed to refresh after ship error:', refreshErr)
        }
        setStateMutation(null)
      },
    })
  }

  // Handle cancel action
  const handleCancel = () => {
    if (!workOrder) return
    setActionFeedback(null)
    setStateMutation('cancelled')
    triggerProtectedAction({
      actionKind: 'work_order.cancel',
      actionTitle: 'Cancel Work Order',
      actionDescription: `Cancel ${workOrder.code}. This action cannot be undone.`,
      workOrderCode: workOrder.code,
      entityName: workOrder.title,
      onConfirm: async (typedConfirmText: string) => {
        await workOrdersApi.update(workOrderId, { state: 'cancelled', typedConfirmText })
        await refreshWorkOrderAndOperations()
        setActionFeedback({
          status: 'success',
          message: 'Work order cancelled successfully.',
        })
        await refreshData()
        setStateMutation(null)
      },
      onError: async (err) => {
        const message = err instanceof Error ? err.message : 'Failed to cancel work order'
        setActionFeedback({
          status: 'error',
          message: `Cancel failed: ${message}`,
        })
        try {
          await refreshWorkOrderAndOperations()
          await refreshData()
        } catch (refreshErr) {
          console.error('Failed to refresh after cancel error:', refreshErr)
        }
        setStateMutation(null)
      },
    })
  }

  const handleArchive = async () => {
    setActionFeedback(null)
    setStateMutation('archived')
    try {
      await workOrdersApi.update(workOrderId, { state: 'archived' })
      await refreshWorkOrderAndOperations()
      await refreshData()
      setActionFeedback({
        status: 'success',
        message: 'Work order archived successfully.',
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to archive work order'
      setActionFeedback({
        status: 'error',
        message: `Archive failed: ${message}`,
      })
      try {
        await refreshWorkOrderAndOperations()
        await refreshData()
      } catch (refreshErr) {
        console.error('Failed to refresh after archive error:', refreshErr)
      }
    } finally {
      setStateMutation(null)
    }
  }

  const handleSaveTags = async () => {
    const nextTags = parseTagsInput(tagInput)
    setSavingTags(true)
    try {
      await workOrdersApi.update(workOrderId, { tags: nextTags })
      setWorkOrder((prev) => (prev ? { ...prev, tags: nextTags, updatedAt: new Date() } : prev))
      await refreshData()
    } catch (err) {
      console.error('Failed to save tags:', err)
    } finally {
      setSavingTags(false)
    }
  }

  const handleStart = async () => {
    setStarting(true)
    setActionFeedback(null)
    setStartFeedback({
      status: 'running',
      message: 'Start requested. Waiting for manager dispatch...',
    })
    try {
      const started = await workOrdersApi.start(workOrderId)
      await refreshWorkOrderAndOperations()
      await refreshData()
      setStartFeedback({
        status: 'success',
        message: `Workflow started successfully at stage ${started.stageIndex + 1}.`,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start workflow'
      console.error('Failed to start workflow:', err)
      setStartFeedback({
        status: 'error',
        message: `Start failed: ${message}`,
      })
      try {
        await refreshWorkOrderAndOperations()
      } catch (refreshErr) {
        console.error('Failed to refresh workflow state after start error:', refreshErr)
      }
      await refreshData()
    } finally {
      setStarting(false)
    }
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
              {workOrder.state === 'planned' && (
                <Button
                  onClick={handleStart}
                  disabled={starting || stateMutation !== null}
                  variant="primary"
                  size="sm"
                >
                  <Play className="w-3.5 h-3.5" />
                  {starting ? 'Starting...' : 'Start'}
                </Button>
              )}
              {canShip && (
                <Button
                  onClick={handleShip}
                  disabled={stateMutation !== null}
                  variant="primary"
                  size="sm"
                >
                  <Ship className="w-3.5 h-3.5" />
                  Ship
                </Button>
              )}
              {canCancel && (
                <Button
                  onClick={handleCancel}
                  disabled={stateMutation !== null}
                  variant="danger"
                  size="sm"
                >
                  <Ban className="w-3.5 h-3.5" />
                  Cancel
                </Button>
              )}
              {canArchive && (
                <Button
                  onClick={handleArchive}
                  disabled={stateMutation !== null}
                  variant="secondary"
                  size="sm"
                >
                  <Archive className="w-3.5 h-3.5" />
                  {stateMutation === 'archived' ? 'Archiving...' : 'Archive'}
                </Button>
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

      {startFeedback && (
        <div className={cn(
          'p-3 rounded-[var(--radius-md)] border flex items-start gap-2',
          startFeedback.status === 'running' && 'bg-status-info/10 border-status-info/30',
          startFeedback.status === 'success' && 'bg-status-success/10 border-status-success/30',
          startFeedback.status === 'error' && 'bg-status-danger/10 border-status-danger/30'
        )}>
          {startFeedback.status === 'running' ? (
            <Clock className="w-4 h-4 text-status-info shrink-0 mt-0.5" />
          ) : startFeedback.status === 'success' ? (
            <CheckCircle className="w-4 h-4 text-status-success shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 text-status-danger shrink-0 mt-0.5" />
          )}
          <span className="text-sm text-fg-1">{startFeedback.message}</span>
        </div>
      )}

      {actionFeedback && (
        <div className={cn(
          'p-3 rounded-[var(--radius-md)] border flex items-start gap-2',
          actionFeedback.status === 'success' && 'bg-status-success/10 border-status-success/30',
          actionFeedback.status === 'error' && 'bg-status-danger/10 border-status-danger/30'
        )}>
          {actionFeedback.status === 'success' ? (
            <CheckCircle className="w-4 h-4 text-status-success shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 text-status-danger shrink-0 mt-0.5" />
          )}
          <span className="text-sm text-fg-1">{actionFeedback.message}</span>
        </div>
      )}

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

      {/* Tags */}
      <div className="p-4 bg-bg-2 border border-bd-0 rounded-[var(--radius-md)]">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="text-sm font-medium text-fg-0">Tags</h3>
          <Button
            onClick={handleSaveTags}
            disabled={savingTags}
            variant="primary"
            size="sm"
          >
            {savingTags ? 'Saving...' : 'Save Tags'}
          </Button>
        </div>
        <input
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          placeholder="feature, urgent, research"
          className="w-full px-3 py-2 text-sm bg-bg-1 border border-bd-1 rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-2 focus:outline-none focus:ring-1 focus:ring-status-info/40"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {workOrder.tags.length === 0 && (
            <span className="text-xs text-fg-3">No tags assigned</span>
          )}
          {workOrder.tags.map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 text-[11px] rounded-full bg-bg-3 text-fg-1 border border-bd-0"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex border-b border-bd-0 overflow-x-auto scrollbar-hide">
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
      <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0 overflow-hidden">
        {activeTab === 'overview' && (
          <OverviewTab
            workOrder={workOrder}
            operations={operations}
            approvals={pendingApprovals}
            onApprovalResolved={refreshData}
          />
        )}
        {activeTab === 'pipeline' && (
          <PipelineTab
            workflowId={workOrder.workflowId}
            workflowStages={workflowStages}
            operations={operations}
          />
        )}
        {activeTab === 'operations' && (
          <OperationsTab operations={operations} />
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
          <ActivityTab activities={activities} workOrderId={workOrderId} agentStationsById={agentStationsById} />
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
        <div className="p-4 bg-bg-3/50 rounded-[var(--radius-md)] border border-bd-0/50">
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
        <div className="p-4 bg-bg-3/50 rounded-[var(--radius-md)] border border-bd-0/50">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-fg-2" />
            <span className="text-xs font-medium text-fg-1">Owner</span>
          </div>
          <div className={cn('text-lg font-semibold', getOwnerTextClass(workOrder.owner, workOrder.ownerType))}>
            {formatOwnerLabel(workOrder.owner, workOrder.ownerType, workOrder.ownerLabel)}
          </div>
          <div className="text-xs text-fg-2 mt-1">
            Created {formatRelativeTime(workOrder.createdAt)}
          </div>
        </div>

        {/* Pending Approvals */}
        <div className="p-4 bg-bg-3/50 rounded-[var(--radius-md)] border border-bd-0/50">
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
      <DispatchErrorCard error={workOrder.blockedReason} title="Blocked" className="p-4" />

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
                  className="flex items-start gap-3 p-3 bg-bg-3/50 rounded-[var(--radius-md)] border border-bd-0/50"
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
                    <Button
                      onClick={() => handleApproval(approval.id, 'rejected')}
                      disabled={isResolving}
                      variant="danger"
                      size="xs"
                    >
                      Reject
                    </Button>
                    <Button
                      onClick={() => handleApproval(approval.id, 'approved')}
                      disabled={isResolving}
                      variant="primary"
                      size="xs"
                    >
                      {isResolving && <LoadingSpinner size="xs" />}
                      Approve
                    </Button>
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
            <dt className="text-fg-2 mb-1">Workflow</dt>
            <dd className="text-fg-1 font-mono text-xs">{workOrder.workflowId ?? 'auto'}</dd>
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
  workflowId,
  workflowStages,
  operations,
}: {
  workflowId: string | null
  workflowStages: Array<{ ref: string; agent: string }>
  operations: OperationDTO[]
}) {
  const fallbackStages = Array.from(
    new Set(
      operations
        .map((operation) => operation.workflowStageIndex)
        .filter((value) => Number.isFinite(value))
    )
  )
    .sort((a, b) => a - b)
    .map((index) => ({
      ref: `stage_${index + 1}`,
      agent: 'unknown',
      index,
    }))

  const stages = workflowStages.length > 0
    ? workflowStages.map((stage, index) => ({ ...stage, index }))
    : fallbackStages

  const opsByStage = operations.reduce((acc, operation) => {
    if (!acc[operation.workflowStageIndex]) acc[operation.workflowStageIndex] = []
    acc[operation.workflowStageIndex].push(operation)
    return acc
  }, {} as Record<number, OperationDTO[]>)

  return (
    <div className="p-6">
      <PageSection
        title="Pipeline"
        description={`Workflow: ${workflowId ?? 'unassigned'}`}
      >
        <div className="flex gap-4 overflow-x-auto pb-2">
          {stages.map((stage, index) => {
            const stageOps = opsByStage[stage.index] || []
            const doneCount = stageOps.filter((op) => op.status === 'done').length
            const inProgressCount = stageOps.filter((op) => op.status === 'in_progress').length
            const blockedCount = stageOps.filter((op) => op.status === 'blocked').length

            return (
              <div
                key={stage.ref}
                className={cn(
                  'flex-shrink-0 w-48 p-4 rounded-[var(--radius-md)] border',
                  stageOps.length === 0
                    ? 'bg-bg-3/30 border-bd-0/50'
                    : 'bg-bg-3/50 border-bd-0'
                )}
              >
                {/* Stage Header */}
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-fg-1">{stage.ref}</span>
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
}: {
  operations: OperationDTO[]
}) {
  return (
    <div className="p-6">
      <PageSection
        title="Operations"
        description={`${operations.length} total (manager-controlled)`}
      >
        {operations.length > 0 ? (
          <div className="space-y-2">
            {operations.map((op) => (
              <div
                key={op.id}
                className="flex items-start gap-3 p-4 bg-bg-3/50 rounded-[var(--radius-md)] border border-bd-0/50 hover:border-bd-0 transition-colors"
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
            description="Start the workflow to let manager create stage operations."
          />
        )}
      </PageSection>
    </div>
  )
}

function ActivityTab({
  activities,
  workOrderId: _workOrderId,
  agentStationsById,
}: {
  activities: ActivityDTO[]
  workOrderId: string
  agentStationsById: Record<string, string>
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
              const isAgentActor = activity.actorType === 'agent'
              const actorLabel = activity.actorLabel || activity.actor
              const stationId = isAgentActor && activity.actorAgentId
                ? agentStationsById[activity.actorAgentId]
                : undefined

              return (
                <div
                  key={activity.id}
                  className="flex items-start gap-3 py-3 border-b border-bd-0/30 last:border-0"
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
                      {activity.actorType !== 'system' && (
                        <>
                          <span className="text-fg-3">•</span>
                          <span className="text-xs text-status-progress font-mono inline-flex items-center gap-1.5">
                            {isAgentActor && <StationIcon stationId={stationId} />}
                            {actorLabel}
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
                  className="flex items-start gap-3 p-4 bg-bg-3/50 rounded-[var(--radius-md)] border border-bd-0/50 hover:border-bd-0 transition-colors"
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
