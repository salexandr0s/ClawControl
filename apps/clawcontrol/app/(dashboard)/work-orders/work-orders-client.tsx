'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { PageHeader, EmptyState } from '@clawcontrol/ui'
import { CanonicalTable, type Column } from '@/components/ui/canonical-table'
import { WorkOrderStatePill, PriorityPill } from '@/components/ui/status-pill'
import { ViewToggle, type ViewMode } from '@/components/ui/view-toggle'
import { KanbanBoard } from '@/components/kanban'
import { RightDrawer } from '@/components/shell/right-drawer'
import { workOrdersApi } from '@/lib/http'
import { useWorkOrderStream } from '@/lib/hooks/useWorkOrderStream'
import type { WorkOrderWithOpsDTO } from '@/lib/repo'
import type { WorkOrderState, Priority, Owner } from '@clawcontrol/core'
import { cn, formatRelativeTime } from '@/lib/utils'
import { ClipboardList, Plus, Filter, Loader2, X } from 'lucide-react'

// ============================================================================
// FILTER TYPES
// ============================================================================

interface WorkOrderFilters {
  state: WorkOrderState | 'all'
  priority: Priority | 'all'
  owner: 'user' | 'clawcontrolceo' | 'all'
}

const DEFAULT_FILTERS: WorkOrderFilters = {
  state: 'all',
  priority: 'all',
  owner: 'all',
}

const STATES: (WorkOrderState | 'all')[] = ['all', 'planned', 'active', 'blocked', 'review', 'shipped', 'cancelled']
const PRIORITIES: (Priority | 'all')[] = ['all', 'P0', 'P1', 'P2', 'P3']
const OWNERS: { value: WorkOrderFilters['owner']; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'user', label: 'User' },
  { value: 'clawcontrolceo', label: 'clawcontrol CEO' },
]

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

// Owner options for create form
const OWNER_OPTIONS: { value: Owner; label: string }[] = [
  { value: 'user', label: 'User' },
  { value: 'clawcontrolceo', label: 'clawcontrol CEO' },
]

// ============================================================================
// NEW WORK ORDER FORM
// ============================================================================

interface NewWorkOrderFormData {
  title: string
  goalMd: string
  priority: Priority
  owner: Owner
}

const DEFAULT_FORM_DATA: NewWorkOrderFormData = {
  title: '',
  goalMd: '',
  priority: 'P2',
  owner: 'user',
}

interface NewWorkOrderModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void
}

function NewWorkOrderModal({ isOpen, onClose, onCreated }: NewWorkOrderModalProps) {
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
      const response = await fetch('/api/work-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create work order')
      }

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

          {/* Priority & Owner Row */}
          <div className="grid grid-cols-2 gap-4">
            {/* Priority */}
            <div>
              <label htmlFor="wo-priority" className="block text-xs font-medium text-fg-1 mb-1.5">
                Priority
              </label>
              <select
                id="wo-priority"
                value={formData.priority}
                onChange={(e) => setFormData((f) => ({ ...f, priority: e.target.value as Priority }))}
                disabled={isSubmitting}
                className="w-full px-3 py-2 text-sm bg-bg-2 border border-bd-1 rounded-[var(--radius-md)] text-fg-0 focus:outline-none focus:ring-1 focus:ring-status-info/50 disabled:opacity-50"
              >
                {PRIORITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label} - {opt.description}
                  </option>
                ))}
              </select>
            </div>

            {/* Owner */}
            <div>
              <label htmlFor="wo-owner" className="block text-xs font-medium text-fg-1 mb-1.5">
                Owner
              </label>
              <select
                id="wo-owner"
                value={formData.owner}
                onChange={(e) => setFormData((f) => ({ ...f, owner: e.target.value as Owner }))}
                disabled={isSubmitting}
                className="w-full px-3 py-2 text-sm bg-bg-2 border border-bd-1 rounded-[var(--radius-md)] text-fg-0 focus:outline-none focus:ring-1 focus:ring-status-info/50 disabled:opacity-50"
              >
                {OWNER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
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
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-medium text-fg-1 hover:text-fg-0 bg-bg-3 rounded-[var(--radius-md)] border border-bd-0 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !formData.title.trim() || !formData.goalMd.trim()}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-bg-0 bg-status-info hover:bg-status-info/90 rounded-[var(--radius-md)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isSubmitting ? 'Creating...' : 'Create Work Order'}
            </button>
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
	      <span className={cn(
	        'text-xs',
	        row.owner === 'clawcontrolceo' ? 'text-status-progress' : 'text-fg-1'
	      )}>
	        {row.owner === 'clawcontrolceo' ? 'clawcontrol CEO' : 'User'}
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
}

function WorkOrderDrawerContent({ workOrder }: WorkOrderDrawerProps) {
  const doneOps = workOrder.operations.filter((op) => op.status === 'done').length
  const totalOps = workOrder.operations.length
  const progressPercent = totalOps > 0 ? Math.round((doneOps / totalOps) * 100) : 0

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

      {/* Blocked reason */}
      {workOrder.blockedReason && (
        <div className="p-3 bg-status-danger/10 border border-status-danger/20 rounded-[var(--radius-md)]">
          <span className="text-xs font-medium text-status-danger">Blocked:</span>
          <p className="text-sm text-fg-1 mt-1">{workOrder.blockedReason}</p>
        </div>
      )}

      {/* Metadata */}
      <div className="pt-3 border-t border-bd-0 space-y-2">
	        <div className="flex justify-between text-xs">
	          <span className="text-fg-2">Owner</span>
	          <span className="text-fg-1">{workOrder.owner === 'clawcontrolceo' ? 'clawcontrol CEO' : 'User'}</span>
	        </div>
        <div className="flex justify-between text-xs">
          <span className="text-fg-2">Routing</span>
          <span className="font-mono text-fg-1">{workOrder.routingTemplate}</span>
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

      {/* Action button */}
      <a
        href={`/work-orders/${workOrder.id}`}
        className="block w-full text-center px-4 py-2 text-xs font-medium bg-bg-3 text-fg-0 hover:bg-bg-3/80 rounded-[var(--radius-md)] border border-bd-0"
      >
        View Full Details
      </a>
    </div>
  )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function WorkOrdersClient() {
  const router = useRouter()
  const [workOrders, setWorkOrders] = useState<WorkOrderWithOpsDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // View toggle state (persisted to localStorage)
  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(VIEW_STORAGE_KEY)
      if (stored === 'table' || stored === 'board') return stored
    }
    return 'table'
  })

  // Drawer state for board view
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrderWithOpsDTO | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Filter state
  const [filters, setFilters] = useState<WorkOrderFilters>(DEFAULT_FILTERS)
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false)

  // New work order modal state
  const [createModalOpen, setCreateModalOpen] = useState(false)

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

  // Persist view preference
  useEffect(() => {
    localStorage.setItem(VIEW_STORAGE_KEY, view)
  }, [view])

  // SSE-driven refresh (with fallback polling when disconnected)
  useWorkOrderStream({
    onRefresh: fetchWorkOrders,
    enabled: view === 'board',
    fallbackPollInterval: 120000, // 2 minutes fallback when SSE disconnected
  })

  // Handle state change from kanban drag-drop
  const handleStateChange = useCallback(
    async (id: string, newState: WorkOrderState, typedConfirmText?: string) => {
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
      } catch (err) {
        console.error('Failed to update state:', err)
        // Refresh to restore correct state (rollback for safe, no-op for dangerous)
        await fetchWorkOrders()
      }
    },
    [fetchWorkOrders]
  )

  // Handle card click in board view
  const handleCardClick = useCallback((wo: WorkOrderWithOpsDTO) => {
    setSelectedWorkOrder(wo)
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
    setSelectedWorkOrder(null)
  }, [])

  // Apply filters to work orders
  const filteredWorkOrders = workOrders.filter((wo) => {
    if (filters.state !== 'all' && wo.state !== filters.state) return false
	    if (filters.priority !== 'all' && wo.priority !== filters.priority) return false
	    if (filters.owner !== 'all') {
	      const isCEO = wo.owner === 'clawcontrolceo'
	      if (filters.owner === 'clawcontrolceo' && !isCEO) return false
	      if (filters.owner === 'user' && isCEO) return false
	    }
	    return true
	  })

  // All filtered work orders shown on board
  const boardWorkOrders = filteredWorkOrders

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-fg-2" />
      </div>
    )
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
            <button
              onClick={() => setFilterDrawerOpen(true)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] border border-bd-0',
                activeFilterCount > 0
                  ? 'bg-status-info/10 text-status-info border-status-info/20'
                  : 'bg-bg-3 text-fg-1 hover:text-fg-0'
              )}
            >
              <Filter className="w-3.5 h-3.5" />
              Filter
              {activeFilterCount > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-status-info text-bg-0 rounded-full">
                  {activeFilterCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setCreateModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-status-info text-bg-0 hover:bg-status-info/90"
            >
              <Plus className="w-3.5 h-3.5" />
              New Work Order
            </button>
          </div>
        }
      />

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
            onWorkOrderClick={handleCardClick}
            onStateChange={handleStateChange}
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
          <WorkOrderDrawerContent workOrder={selectedWorkOrder} />
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
              {OWNERS.map(({ value, label }) => (
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
      />
    </div>
  )
}
