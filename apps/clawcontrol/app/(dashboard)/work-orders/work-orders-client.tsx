'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { PageHeader, EmptyState, Button, buttonLikeClass, SelectDropdown } from '@clawcontrol/ui'
import { CanonicalTable, type Column } from '@/components/ui/canonical-table'
import { WorkOrderStatePill, PriorityPill } from '@/components/ui/status-pill'
import { ViewToggle, type ViewMode } from '@/components/ui/view-toggle'
import { LoadingSpinner, LoadingState } from '@/components/ui/loading-state'
import { KanbanBoard } from '@/components/kanban'
import { RightDrawer } from '@/components/shell/right-drawer'
import { DispatchErrorCard } from '@/components/work-orders/dispatch-error-card'
import { agentsApi, workOrdersApi } from '@/lib/http'
import { useWorkOrderStream } from '@/lib/hooks/useWorkOrderStream'
import type { AgentDTO, WorkOrderWithOpsDTO } from '@/lib/repo'
import type { WorkOrderState, Priority, Owner } from '@clawcontrol/core'
import { cn, formatRelativeTime } from '@/lib/utils'
import { usePageReadyTiming } from '@/lib/perf/client-timing'
import { ClipboardList, Plus, Filter, X, CheckCircle, AlertCircle, XCircle } from 'lucide-react'
import { formatOwnerLabel, ownerTextTone } from '@/lib/agent-identity'

// ============================================================================
// FILTER TYPES
// ============================================================================

interface WorkOrderFilters {
  state: WorkOrderState | 'all'
  priority: Priority | 'all'
  owner: string | 'all'
  showArchive: boolean
}

const DEFAULT_FILTERS: WorkOrderFilters = {
  state: 'all',
  priority: 'all',
  owner: 'all',
  showArchive: true,
}

const STATES: (WorkOrderState | 'all')[] = ['all', 'planned', 'active', 'blocked', 'review', 'shipped', 'archived', 'cancelled']
const PRIORITIES: (Priority | 'all')[] = ['all', 'P0', 'P1', 'P2', 'P3']

// ============================================================================
// CONSTANTS
// ============================================================================

const VIEW_STORAGE_KEY = 'clawcontrol-work-orders-view'

// Priority options for create form
const PRIORITY_OPTIONS: { value: Priority; label: string; description: string }[] = [
  { value: 'P0', label: 'P0', description: 'Critical - Drop everything' },
  { value: 'P1', label: 'P1', description: 'High - Do this week' },
  { value: 'P2', label: 'P2', description: 'Medium - Normal priority' },
  { value: 'P3', label: 'P3', description: 'Low - When time permits' },
]

const TAG_PRESETS = [
  'bug',
  'feature',
  'research',
  'content',
  'infrastructure',
  'urgent',
  'blocked',
  'needs-review',
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
  return ownerTextTone(owner, ownerType) === 'user' ? 'text-fg-1' : 'text-status-progress'
}

function getStateActionLabel(state: WorkOrderState): string {
  switch (state) {
    case 'archived':
      return 'Archive'
    case 'cancelled':
      return 'Cancel'
    case 'shipped':
      return 'Ship'
    case 'blocked':
      return 'Block'
    case 'review':
      return 'Move to review'
    case 'active':
      return 'Activate'
    case 'planned':
      return 'Move to planned'
    default:
      return 'Update'
  }
}

// ============================================================================
// NEW WORK ORDER FORM
// ============================================================================

interface NewWorkOrderFormData {
  title: string
  goalMd: string
  priority: Priority
  owner: Owner
  tagsInput: string
  workflowId: string
}

const DEFAULT_FORM_DATA: NewWorkOrderFormData = {
  title: '',
  goalMd: '',
  priority: 'P2',
  owner: 'user',
  tagsInput: '',
  workflowId: '',
}

interface NewWorkOrderModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void
  ownerOptions: { value: Owner; label: string }[]
  workflowOptions: Array<{ id: string; label: string }>
}

function NewWorkOrderModal({
  isOpen,
  onClose,
  onCreated,
  ownerOptions,
  workflowOptions,
}: NewWorkOrderModalProps) {
  const [formData, setFormData] = useState<NewWorkOrderFormData>(DEFAULT_FORM_DATA)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setFormData(DEFAULT_FORM_DATA)
      setError(null)
      // Focus title input after a short delay
      setTimeout(() => titleInputRef.current?.focus(), 100)
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
    if (!formData.title.trim() || !formData.goalMd.trim()) {
      setError('Title and goal are required')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const ownerToken = formData.owner
      const isAgentOwner = ownerToken.startsWith('agent:')
      const normalizedOwnerType = isAgentOwner
        ? 'agent'
        : ownerToken === 'system'
          ? 'system'
          : 'user'
      const normalizedOwnerAgentId = isAgentOwner ? ownerToken.slice('agent:'.length) : null

      await workOrdersApi.create({
        title: formData.title,
        goalMd: formData.goalMd,
        priority: formData.priority,
        owner: ownerToken,
        ownerType: normalizedOwnerType,
        ownerAgentId: normalizedOwnerAgentId,
        tags: parseTagsInput(formData.tagsInput),
        workflowId: formData.workflowId || undefined,
      })

      onCreated()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create work order')
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
      <div className="relative bg-bg-1 border border-bd-1 rounded-[var(--radius-lg)] shadow-2xl w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-bd-0">
          <h2 className="text-base font-medium text-fg-0">New Work Order</h2>
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
          {/* Title */}
          <div>
            <label htmlFor="wo-title" className="block text-xs font-medium text-fg-1 mb-1.5">
              Title
            </label>
            <input
              ref={titleInputRef}
              id="wo-title"
              type="text"
              value={formData.title}
              onChange={(e) => setFormData((f) => ({ ...f, title: e.target.value }))}
              placeholder="Brief description of the work"
              disabled={isSubmitting}
              className="w-full px-3 py-2 text-sm bg-bg-2 border border-bd-1 rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-2 focus:outline-none focus:ring-1 focus:ring-status-info/50 disabled:opacity-50"
            />
          </div>

          {/* Goal */}
          <div>
            <label htmlFor="wo-goal" className="block text-xs font-medium text-fg-1 mb-1.5">
              Goal
            </label>
            <textarea
              id="wo-goal"
              value={formData.goalMd}
              onChange={(e) => setFormData((f) => ({ ...f, goalMd: e.target.value }))}
              placeholder="Describe what needs to be accomplished..."
              rows={4}
              disabled={isSubmitting}
              className="w-full px-3 py-2 text-sm bg-bg-2 border border-bd-1 rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-2 focus:outline-none focus:ring-1 focus:ring-status-info/50 resize-none disabled:opacity-50"
            />
          </div>

          {/* Tags */}
          <div>
            <label htmlFor="wo-tags" className="block text-xs font-medium text-fg-1 mb-1.5">
              Tags
            </label>
            <input
              id="wo-tags"
              type="text"
              value={formData.tagsInput}
              onChange={(e) => setFormData((f) => ({ ...f, tagsInput: e.target.value }))}
              placeholder="feature, urgent, research"
              disabled={isSubmitting}
              className="w-full px-3 py-2 text-sm bg-bg-2 border border-bd-1 rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-2 focus:outline-none focus:ring-1 focus:ring-status-info/50 disabled:opacity-50"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {TAG_PRESETS.map((tag) => {
                const selected = parseTagsInput(formData.tagsInput).includes(tag)
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => {
                      const nextTags = parseTagsInput(formData.tagsInput)
                      const updated = nextTags.includes(tag)
                        ? nextTags.filter((value) => value !== tag)
                        : [...nextTags, tag]
                      setFormData((f) => ({ ...f, tagsInput: updated.join(', ') }))
                    }}
                    className={cn(
                      'px-2 py-0.5 text-[11px] rounded-full border transition-colors',
                      selected
                        ? 'bg-status-info/10 text-status-info border-status-info/30'
                        : 'bg-bg-3 text-fg-2 border-bd-0 hover:text-fg-1'
                    )}
                  >
                    {tag}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Priority & Owner Row */}
          <div className="grid grid-cols-3 gap-4">
            {/* Priority */}
            <div>
              <label className="block text-xs font-medium text-fg-1 mb-1.5">
                Priority
              </label>
              <SelectDropdown
                value={formData.priority}
                onChange={(nextValue) => setFormData((f) => ({ ...f, priority: nextValue as Priority }))}
                disabled={isSubmitting}
                ariaLabel="Work order priority"
                tone="field"
                size="md"
                options={PRIORITY_OPTIONS.map((opt) => ({
                  value: opt.value,
                  label: opt.label,
                  description: opt.description,
                  textValue: `${opt.label} ${opt.description}`,
                }))}
              />
            </div>

            {/* Owner */}
            <div>
              <label className="block text-xs font-medium text-fg-1 mb-1.5">
                Owner
              </label>
              <SelectDropdown
                value={formData.owner}
                onChange={(nextValue) => setFormData((f) => ({ ...f, owner: nextValue as Owner }))}
                disabled={isSubmitting}
                ariaLabel="Work order owner"
                tone="field"
                size="md"
                options={ownerOptions.map((opt) => ({
                  value: opt.value,
                  label: opt.label,
                  textValue: `${opt.label} ${opt.value}`,
                }))}
              />
            </div>

            {/* Workflow */}
            <div>
              <label className="block text-xs font-medium text-fg-1 mb-1.5">
                Workflow
              </label>
              <SelectDropdown
                value={formData.workflowId}
                onChange={(nextValue) => setFormData((f) => ({ ...f, workflowId: nextValue }))}
                disabled={isSubmitting}
                ariaLabel="Work order workflow"
                tone="field"
                size="md"
                options={[
                  { value: '', label: 'Auto (deterministic)', textValue: 'auto deterministic workflow' },
                  ...workflowOptions.map((workflow) => ({
                    value: workflow.id,
                    label: workflow.label,
                  })),
                ]}
              />
            </div>
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
              disabled={isSubmitting || !formData.title.trim() || !formData.goalMd.trim()}
              variant="primary"
              size="md"
            >
              {isSubmitting && <LoadingSpinner size="sm" />}
              {isSubmitting ? 'Creating...' : 'Create Work Order'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ============================================================================
// TABLE COLUMNS
// ============================================================================

const workOrderColumns: Column<WorkOrderWithOpsDTO>[] = [
  {
    key: 'code',
    header: 'Code',
    width: '80px',
    mono: true,
    render: (row) => (
      <span className="text-fg-1 hover:text-fg-0">{row.code}</span>
    ),
  },
  {
    key: 'title',
    header: 'Title',
    render: (row) => (
      <span className="truncate max-w-[320px] inline-block">{row.title}</span>
    ),
  },
  {
    key: 'tags',
    header: 'Tags',
    render: (row) => (
      <div className="flex flex-wrap gap-1 max-w-[220px]">
        {row.tags.slice(0, 3).map((tag) => (
          <span
            key={tag}
            className="px-1.5 py-0.5 text-[10px] rounded-full bg-bg-3 text-fg-1 border border-bd-0"
          >
            {tag}
          </span>
        ))}
        {row.tags.length > 3 && (
          <span className="text-[10px] text-fg-2">+{row.tags.length - 3}</span>
        )}
      </div>
    ),
  },
  {
    key: 'state',
    header: 'State',
    width: '100px',
    render: (row) => <WorkOrderStatePill state={row.state} />,
  },
  {
    key: 'priority',
    header: 'Pri',
    width: '60px',
    align: 'center',
    render: (row) => <PriorityPill priority={row.priority} />,
  },
  {
    key: 'owner',
    header: 'Owner',
    width: '100px',
    render: (row) => (
      <span className={cn('text-xs', getOwnerTextClass(row.owner, row.ownerType))}>
        {formatOwnerLabel(row.owner, row.ownerType, row.ownerLabel)}
      </span>
    ),
  },
  {
    key: 'updatedAt',
    header: 'Updated',
    width: '100px',
    align: 'right',
    render: (row) => (
      <span className="text-fg-2 text-xs">{formatRelativeTime(row.updatedAt)}</span>
    ),
  },
]

// ============================================================================
// WORK ORDER DRAWER CONTENT
// ============================================================================

interface WorkOrderDrawerProps {
  workOrder: WorkOrderWithOpsDTO
  onStart?: (workOrderId: string) => Promise<void>
  onArchive?: (workOrderId: string) => Promise<void>
  startingWorkOrderId?: string | null
  transitioningWorkOrderId?: string | null
  startFeedback?: StartFeedback | null
  actionFeedback?: ActionFeedback | null
}

interface StartFeedback {
  status: 'running' | 'success' | 'error'
  message: string
}

interface ActionFeedback {
  status: 'success' | 'error'
  message: string
}

function WorkOrderDrawerContent({
  workOrder,
  onStart,
  onArchive,
  startingWorkOrderId,
  transitioningWorkOrderId,
  startFeedback,
  actionFeedback,
}: WorkOrderDrawerProps) {
  const doneOps = workOrder.operations.filter((op) => op.status === 'done').length
  const totalOps = workOrder.operations.length
  const progressPercent = totalOps > 0 ? Math.round((doneOps / totalOps) * 100) : 0
  const isStarting = startingWorkOrderId === workOrder.id
  const isTransitioning = transitioningWorkOrderId === workOrder.id

  return (
    <div className="space-y-4">
      {/* Header info */}
      <div className="flex items-center gap-3">
        <span className="font-mono text-sm font-medium text-fg-0">{workOrder.code}</span>
        <WorkOrderStatePill state={workOrder.state} />
        <PriorityPill priority={workOrder.priority} />
      </div>

      {/* Title */}
      <h3 className="text-base font-medium text-fg-0">{workOrder.title}</h3>

      {/* Tags */}
      {workOrder.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {workOrder.tags.map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 text-[11px] rounded-full bg-bg-3 text-fg-1 border border-bd-0"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Goal */}
      {workOrder.goalMd && (
        <div className="text-sm text-fg-1 whitespace-pre-wrap">
          {workOrder.goalMd}
        </div>
      )}

      {/* Progress */}
      {totalOps > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-fg-2">Operations Progress</span>
            <span className="text-xs text-fg-1">{doneOps}/{totalOps} ({progressPercent}%)</span>
          </div>
          <div className="h-1.5 bg-bg-3 rounded-full overflow-hidden">
            <div
              className="h-full bg-status-success transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {startFeedback && (
        <div className={cn(
          'p-3 rounded-[var(--radius-md)] border flex items-start gap-2',
          startFeedback.status === 'running' && 'bg-status-info/10 border-status-info/30',
          startFeedback.status === 'success' && 'bg-status-success/10 border-status-success/30',
          startFeedback.status === 'error' && 'bg-status-danger/10 border-status-danger/30'
        )}>
          {startFeedback.status === 'running' ? (
            <AlertCircle className="w-4 h-4 text-status-info mt-0.5 shrink-0" />
          ) : startFeedback.status === 'success' ? (
            <CheckCircle className="w-4 h-4 text-status-success mt-0.5 shrink-0" />
          ) : (
            <XCircle className="w-4 h-4 text-status-danger mt-0.5 shrink-0" />
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
            <CheckCircle className="w-4 h-4 text-status-success mt-0.5 shrink-0" />
          ) : (
            <XCircle className="w-4 h-4 text-status-danger mt-0.5 shrink-0" />
          )}
          <span className="text-sm text-fg-1">{actionFeedback.message}</span>
        </div>
      )}

      {/* Blocked reason */}
      <DispatchErrorCard error={workOrder.blockedReason} title="Blocked" />

      {/* Metadata */}
      <div className="pt-3 border-t border-bd-0 space-y-2">
        <div className="flex justify-between text-xs">
          <span className="text-fg-2">Owner</span>
          <span className={cn('text-fg-1', getOwnerTextClass(workOrder.owner, workOrder.ownerType))}>
            {formatOwnerLabel(workOrder.owner, workOrder.ownerType, workOrder.ownerLabel)}
          </span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-fg-2">Workflow</span>
          <span className="font-mono text-fg-1">{workOrder.workflowId ?? 'auto'}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-fg-2">Updated</span>
          <span className="text-fg-1">{formatRelativeTime(workOrder.updatedAt)}</span>
        </div>
        {workOrder.shippedAt && (
          <div className="flex justify-between text-xs">
            <span className="text-fg-2">Shipped</span>
            <span className="text-status-success">{formatRelativeTime(workOrder.shippedAt)}</span>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {workOrder.state === 'planned' && (
          <Button
            onClick={() => onStart?.(workOrder.id)}
            disabled={isStarting || isTransitioning}
            variant="primary"
            size="md"
            className="w-full"
          >
            {isStarting ? 'Starting...' : 'Start Workflow'}
          </Button>
        )}
        {workOrder.state === 'shipped' && (
          <Button
            onClick={() => onArchive?.(workOrder.id)}
            disabled={isTransitioning}
            variant="secondary"
            size="md"
            className="w-full"
          >
            {isTransitioning ? 'Archiving...' : 'Archive'}
          </Button>
        )}
        <a
          href={`/work-orders/${workOrder.id}`}
          className={buttonLikeClass({
            variant: 'secondary',
            size: 'md',
            className: 'w-full',
          })}
        >
          View Full Details
        </a>
      </div>
    </div>
  )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function WorkOrdersClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [workOrders, setWorkOrders] = useState<WorkOrderWithOpsDTO[]>([])
  const [agents, setAgents] = useState<AgentDTO[]>([])
  const [workflowOptions, setWorkflowOptions] = useState<Array<{ id: string; label: string }>>([])
  const [assigningWorkOrderId, setAssigningWorkOrderId] = useState<string | null>(null)
  const [startingWorkOrderId, setStartingWorkOrderId] = useState<string | null>(null)
  const [transitioningWorkOrderId, setTransitioningWorkOrderId] = useState<string | null>(null)
  const [queueTickMessage, setQueueTickMessage] = useState<string | null>(null)
  const [queueTickError, setQueueTickError] = useState<string | null>(null)
  const [startFeedbackByWorkOrderId, setStartFeedbackByWorkOrderId] = useState<Record<string, StartFeedback>>({})
  const [actionFeedbackByWorkOrderId, setActionFeedbackByWorkOrderId] = useState<Record<string, ActionFeedback>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  usePageReadyTiming('work-orders', !loading)

  // View toggle state (persisted to localStorage)
  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(VIEW_STORAGE_KEY)
      if (stored === 'table' || stored === 'board') return stored
    }
    return 'board'
  })

  // Drawer state for board view
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Filter state
  const [filters, setFilters] = useState<WorkOrderFilters>(DEFAULT_FILTERS)
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false)

  // New work order modal state
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [consumedOpenWorkOrderId, setConsumedOpenWorkOrderId] = useState<string | null>(null)

  const ownerOptions = useMemo<{ value: Owner; label: string }[]>(() => {
    const staticValues: Array<{ value: Owner; label: string }> = [
      { value: 'user', label: 'User' },
      { value: 'system', label: 'System' },
    ]
    const agentValues = agents.map((agent) => ({
      value: `agent:${agent.id}`,
      label: agent.displayName,
    }))

    return [...staticValues, ...agentValues]
  }, [agents])

  const ownerFilterOptions = useMemo<{ value: WorkOrderFilters['owner']; label: string }[]>(() => {
    const values = new Map<string, string>()
    values.set('user', 'User')
    values.set('system', 'System')

    for (const agent of agents) {
      values.set(`agent:${agent.id}`, agent.displayName)
    }

    for (const workOrder of workOrders) {
      if (workOrder.ownerType === 'agent' && workOrder.ownerAgentId) {
        values.set(
          `agent:${workOrder.ownerAgentId}`,
          workOrder.ownerLabel || formatOwnerLabel(workOrder.owner, workOrder.ownerType, workOrder.ownerLabel)
        )
        continue
      }

      const fallbackValue = workOrder.ownerType || workOrder.owner
      values.set(
        fallbackValue,
        workOrder.ownerLabel || formatOwnerLabel(workOrder.owner, workOrder.ownerType, workOrder.ownerLabel)
      )
    }

    return [
      { value: 'all', label: 'All' },
      ...Array.from(values.entries()).map(([value, label]) => ({
        value,
        label,
      })),
    ]
  }, [agents, workOrders])

  const selectedWorkOrder = useMemo(
    () => (selectedWorkOrderId ? workOrders.find((workOrder) => workOrder.id === selectedWorkOrderId) ?? null : null),
    [selectedWorkOrderId, workOrders]
  )
  const requestedOpenWorkOrderId = searchParams.get('openWorkOrderId')

  // Count active filters
  const activeFilterCount = Object.entries(filters).filter(
    ([key, value]) => value !== DEFAULT_FILTERS[key as keyof WorkOrderFilters]
  ).length

  // Fetch work orders
  const fetchWorkOrders = useCallback(async () => {
    try {
      const result = await workOrdersApi.list()
      setWorkOrders(result.data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load work orders')
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial fetch
  useEffect(() => {
    fetchWorkOrders()
  }, [fetchWorkOrders])

  useEffect(() => {
    let isMounted = true
    const fetchAgentsAndWorkflows = async () => {
      try {
        const [agentResult, workflowResponse] = await Promise.all([
          agentsApi.list({
            mode: 'light',
            includeSessionOverlay: false,
            includeModelOverlay: false,
            syncSessions: false,
            cacheTtlMs: 5000,
          }),
          fetch('/api/workflows', {
            method: 'GET',
            headers: { Accept: 'application/json' },
          }),
        ])

        const workflowJson = (await workflowResponse.json()) as {
          data?: Array<{ id: string; description?: string }>
        }
        if (isMounted) {
          setAgents(agentResult.data)
          setWorkflowOptions(
            (workflowJson.data ?? []).map((workflow) => ({
              id: workflow.id,
              label: workflow.description ? `${workflow.id} — ${workflow.description}` : workflow.id,
            }))
          )
        }
      } catch (err) {
        console.error('Failed to load work-order metadata:', err)
      }
    }

    fetchAgentsAndWorkflows()
    return () => {
      isMounted = false
    }
  }, [])

  // Persist view preference
  useEffect(() => {
    localStorage.setItem(VIEW_STORAGE_KEY, view)
  }, [view])

  useEffect(() => {
    if (!requestedOpenWorkOrderId) return
    if (consumedOpenWorkOrderId === requestedOpenWorkOrderId) return

    const found = workOrders.find((wo) => wo.id === requestedOpenWorkOrderId)
    if (!found) return

    if (view !== 'board') {
      setView('board')
    }
    setSelectedWorkOrderId(found.id)
    setDrawerOpen(true)
    setConsumedOpenWorkOrderId(requestedOpenWorkOrderId)
  }, [consumedOpenWorkOrderId, requestedOpenWorkOrderId, view, workOrders])

  // SSE-driven refresh (with fallback polling when disconnected)
  useWorkOrderStream({
    onRefresh: fetchWorkOrders,
    enabled: view === 'board',
    fallbackPollInterval: 120000, // 2 minutes fallback when SSE disconnected
  })

  // Handle state change from kanban drag-drop
  const handleStateChange = useCallback(
    async (id: string, newState: WorkOrderState, typedConfirmText?: string) => {
      const currentWorkOrder = workOrders.find((workOrder) => workOrder.id === id)
      const actionLabel = getStateActionLabel(newState)
      setTransitioningWorkOrderId(id)
      setActionFeedbackByWorkOrderId((prev) => {
        if (!prev[id]) return prev
        const next = { ...prev }
        delete next[id]
        return next
      })
      if (currentWorkOrder?.state === 'planned' && newState === 'active') {
        try {
          await workOrdersApi.start(id)
          await fetchWorkOrders()
          setActionFeedbackByWorkOrderId((prev) => ({
            ...prev,
            [id]: {
              status: 'success',
              message: 'Workflow started successfully.',
            },
          }))
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to start work order'
          await fetchWorkOrders()
          setActionFeedbackByWorkOrderId((prev) => ({
            ...prev,
            [id]: {
              status: 'error',
              message: `Start failed: ${message}`,
            },
          }))
        } finally {
          setTransitioningWorkOrderId(null)
        }
        return
      }

      // For dangerous transitions (ship/cancel), skip optimistic update
      // These go through TypedConfirmModal and should only update after server confirms
      const isDangerous = newState === 'shipped' || newState === 'cancelled'

      if (!isDangerous) {
        // Optimistic update for safe transitions
        setWorkOrders((prev) =>
          prev.map((wo) =>
            wo.id === id
              ? { ...wo, state: newState, updatedAt: new Date() }
              : wo
          )
        )
      }

      try {
        await workOrdersApi.update(id, {
          state: newState,
          typedConfirmText,
        })
        // Refresh to get server state
        await fetchWorkOrders()
        setActionFeedbackByWorkOrderId((prev) => ({
          ...prev,
          [id]: {
            status: 'success',
            message: `${actionLabel} completed.`,
          },
        }))
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update work order state'
        // Refresh to restore correct state (rollback for safe, no-op for dangerous)
        await fetchWorkOrders()
        setActionFeedbackByWorkOrderId((prev) => ({
          ...prev,
          [id]: {
            status: 'error',
            message: `${actionLabel} failed: ${message}`,
          },
        }))
      } finally {
        setTransitioningWorkOrderId(null)
      }
    },
    [fetchWorkOrders, workOrders]
  )

  const handleAssignToAgent = useCallback(
    async (id: string, agentId: string) => {
      setAssigningWorkOrderId(id)
      const assignedAgent = agents.find((agent) => agent.id === agentId)
      const ownerLabel = assignedAgent?.displayName || `agent:${agentId}`

      // Planned column behaves as an assignment queue. Claiming assigns owner and activates.
      // Manager engine start remains explicit and separate.
      setWorkOrders((prev) =>
        prev.map((wo) =>
          wo.id === id
            ? {
                ...wo,
                owner: `agent:${agentId}`,
                ownerType: 'agent',
                ownerAgentId: agentId,
                ownerLabel,
                updatedAt: new Date(),
              }
            : wo
        )
      )

      try {
        await workOrdersApi.update(id, {
          owner: `agent:${agentId}`,
          ownerType: 'agent',
          ownerAgentId: agentId,
        })
        await fetchWorkOrders()
      } catch (err) {
        console.error('Failed to assign work order:', err)
        await fetchWorkOrders()
      } finally {
        setAssigningWorkOrderId(null)
      }
    },
    [agents, fetchWorkOrders]
  )

  const handleStartWorkOrder = useCallback(async (workOrderId: string) => {
    setStartingWorkOrderId(workOrderId)
    setQueueTickError(null)
    setQueueTickMessage(null)
    setStartFeedbackByWorkOrderId((prev) => ({
      ...prev,
      [workOrderId]: {
        status: 'running',
        message: 'Start requested. Waiting for manager dispatch...',
      },
    }))
    try {
      const started = await workOrdersApi.start(workOrderId)
      await fetchWorkOrders()
      setQueueTickMessage(`Started workflow for stage ${started.stageIndex + 1}.`)
      setStartFeedbackByWorkOrderId((prev) => ({
        ...prev,
        [workOrderId]: {
          status: 'success',
          message: 'Workflow started successfully.',
        },
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start work order'
      await fetchWorkOrders()
      setQueueTickError(message)
      setStartFeedbackByWorkOrderId((prev) => ({
        ...prev,
        [workOrderId]: {
          status: 'error',
          message: `Start failed: ${message}`,
        },
      }))
    } finally {
      setStartingWorkOrderId(null)
    }
  }, [fetchWorkOrders])

  const handleArchiveWorkOrder = useCallback(async (workOrderId: string) => {
    await handleStateChange(workOrderId, 'archived')
  }, [handleStateChange])

  // Handle card click in board view
  const handleCardClick = useCallback((wo: WorkOrderWithOpsDTO) => {
    setSelectedWorkOrderId(wo.id)
    setDrawerOpen(true)
  }, [])

  // Handle row click in table view
  const handleRowClick = useCallback(
    (row: WorkOrderWithOpsDTO) => {
      router.push(`/work-orders/${row.id}`)
    },
    [router]
  )

  // Close drawer
  const handleCloseDrawer = useCallback(() => {
    setDrawerOpen(false)
    setSelectedWorkOrderId(null)
  }, [])

  // Apply filters to work orders
  const filteredWorkOrders = workOrders.filter((wo) => {
    if (filters.state !== 'all' && wo.state !== filters.state) return false
    if (filters.priority !== 'all' && wo.priority !== filters.priority) return false
    if (filters.owner !== 'all') {
      const ownerFilter = filters.owner
      if (ownerFilter.startsWith('agent:')) {
        if (wo.ownerType !== 'agent' || wo.ownerAgentId !== ownerFilter.slice('agent:'.length)) {
          return false
        }
      } else if (ownerFilter === 'user' || ownerFilter === 'system') {
        if (wo.ownerType !== ownerFilter) return false
      } else if (wo.owner !== ownerFilter) {
        return false
      }
    }
    return true
  })

  // All filtered work orders shown on board
  const boardWorkOrders = filteredWorkOrders

  // Loading state
  if (loading) {
    return <LoadingState height="viewport" />
  }

  // Error state
  if (error) {
    return (
      <EmptyState
        icon={<ClipboardList className="w-8 h-8" />}
        title="Error loading work orders"
        description={error}
      />
    )
  }

  return (
    <div className="w-full space-y-4">
      <PageHeader
        title="Work Orders"
        subtitle={activeFilterCount > 0 ? `${filteredWorkOrders.length} of ${workOrders.length}` : `${workOrders.length} total`}
        actions={
          <div className="flex items-center gap-2">
            <ViewToggle value={view} onChange={setView} />
            <Button
              onClick={() => setFilterDrawerOpen(true)}
              variant="secondary"
              size="sm"
              className={cn(activeFilterCount > 0 && 'text-status-info border-status-info/20 bg-status-info/10 hover:bg-status-info/20')}
            >
              <Filter className="w-3.5 h-3.5" />
              Filter
              {activeFilterCount > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-status-progress text-white rounded-full">
                  {activeFilterCount}
                </span>
              )}
            </Button>
            <Button
              onClick={() => setCreateModalOpen(true)}
              variant="primary"
              size="sm"
            >
              <Plus className="w-3.5 h-3.5" />
              New Work Order
            </Button>
          </div>
        }
      />

      {queueTickError && (
        <div className="p-2 rounded-[var(--radius-md)] border border-status-warning/20 bg-status-warning/10 text-status-warning text-xs break-words [overflow-wrap:anywhere]">
          Start error: {queueTickError}
        </div>
      )}

      {queueTickMessage && (
        <div className="p-2 rounded-[var(--radius-md)] border border-status-info/20 bg-status-info/10 text-status-info text-xs">
          {queueTickMessage}
        </div>
      )}

      {/* Table View */}
      {view === 'table' && (
        <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0 overflow-hidden">
          <CanonicalTable
            columns={workOrderColumns}
            rows={filteredWorkOrders}
            rowKey={(row) => row.id}
            onRowClick={handleRowClick}
            density="compact"
            emptyState={
              <EmptyState
                icon={<ClipboardList className="w-8 h-8" />}
                title={activeFilterCount > 0 ? "No matching work orders" : "No work orders yet"}
                description={activeFilterCount > 0 ? "Try adjusting your filters" : "Create one to get started."}
              />
            }
          />
        </div>
      )}

      {/* Board View - fills available viewport height */}
      {view === 'board' && (
        <div className="flex-1 min-h-0 h-[calc(100vh-180px)]">
          <KanbanBoard
            workOrders={boardWorkOrders}
            agents={agents}
            assigningWorkOrderId={assigningWorkOrderId}
            showArchive={filters.showArchive}
            onWorkOrderClick={handleCardClick}
            onStateChange={handleStateChange}
            onAssignToAgent={handleAssignToAgent}
          />
        </div>
      )}

      {/* Detail Drawer (for board view) */}
      <RightDrawer
        open={drawerOpen}
        onClose={handleCloseDrawer}
        title={selectedWorkOrder?.code}
        description="Work Order Details"
      >
        {selectedWorkOrder && (
          <WorkOrderDrawerContent
            workOrder={selectedWorkOrder}
            onStart={handleStartWorkOrder}
            onArchive={handleArchiveWorkOrder}
            startingWorkOrderId={startingWorkOrderId}
            transitioningWorkOrderId={transitioningWorkOrderId}
            startFeedback={startFeedbackByWorkOrderId[selectedWorkOrder.id] ?? null}
            actionFeedback={actionFeedbackByWorkOrderId[selectedWorkOrder.id] ?? null}
          />
        )}
      </RightDrawer>

      {/* Filter Drawer */}
      <RightDrawer
        open={filterDrawerOpen}
        onClose={() => setFilterDrawerOpen(false)}
        title="Filter Work Orders"
        description={`${filteredWorkOrders.length} of ${workOrders.length} shown`}
      >
        <div className="space-y-6">
          {/* State Filter */}
          <div>
            <label className="block text-xs font-medium text-fg-1 mb-2">State</label>
            <div className="flex flex-wrap gap-1.5">
              {STATES.map((state) => (
                <button
                  key={state}
                  onClick={() => setFilters((f) => ({ ...f, state }))}
                  className={cn(
                    'px-2.5 py-1 text-xs font-medium rounded-[var(--radius-md)] border transition-colors',
                    filters.state === state
                      ? 'bg-status-info/10 text-status-info border-status-info/30'
                      : 'bg-bg-3 text-fg-1 border-bd-0 hover:text-fg-0'
                  )}
                >
                  {state === 'all' ? 'All' : state.charAt(0).toUpperCase() + state.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Priority Filter */}
          <div>
            <label className="block text-xs font-medium text-fg-1 mb-2">Priority</label>
            <div className="flex flex-wrap gap-1.5">
              {PRIORITIES.map((priority) => (
                <button
                  key={priority}
                  onClick={() => setFilters((f) => ({ ...f, priority }))}
                  className={cn(
                    'px-2.5 py-1 text-xs font-medium rounded-[var(--radius-md)] border transition-colors',
                    filters.priority === priority
                      ? 'bg-status-info/10 text-status-info border-status-info/30'
                      : 'bg-bg-3 text-fg-1 border-bd-0 hover:text-fg-0'
                  )}
                >
                  {priority === 'all' ? 'All' : priority.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Owner Filter */}
          <div>
            <label className="block text-xs font-medium text-fg-1 mb-2">Owner</label>
            <div className="flex flex-wrap gap-1.5">
              {ownerFilterOptions.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setFilters((f) => ({ ...f, owner: value }))}
                  className={cn(
                    'px-2.5 py-1 text-xs font-medium rounded-[var(--radius-md)] border transition-colors',
                    filters.owner === value
                      ? 'bg-status-info/10 text-status-info border-status-info/30'
                      : 'bg-bg-3 text-fg-1 border-bd-0 hover:text-fg-0'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Board Column Toggle */}
          <div>
            <label className="block text-xs font-medium text-fg-1 mb-2">Board Columns</label>
            <label className="flex items-center gap-2 px-2.5 py-2 rounded-[var(--radius-md)] border border-bd-0 bg-bg-3">
              <input
                type="checkbox"
                checked={filters.showArchive}
                onChange={(event) => setFilters((f) => ({ ...f, showArchive: event.target.checked }))}
                className="h-3.5 w-3.5 rounded border-bd-1 bg-bg-2 accent-status-info"
              />
              <span className="text-xs text-fg-1">Show Archive</span>
            </label>
            <p className="mt-1 text-[11px] text-fg-3">
              Archive column shows archived and cancelled work orders in board view.
            </p>
          </div>

          {/* Clear Filters Button */}
          {activeFilterCount > 0 && (
            <button
              onClick={() => setFilters(DEFAULT_FILTERS)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-fg-1 hover:text-fg-0 bg-bg-3 rounded-[var(--radius-md)] border border-bd-0 w-full justify-center"
            >
              <X className="w-3.5 h-3.5" />
              Clear All Filters
            </button>
          )}
        </div>
      </RightDrawer>

      {/* New Work Order Modal */}
      <NewWorkOrderModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreated={fetchWorkOrders}
        ownerOptions={ownerOptions}
        workflowOptions={workflowOptions}
      />
    </div>
  )
}
