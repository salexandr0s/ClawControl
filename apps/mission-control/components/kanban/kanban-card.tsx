'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/utils'
import { PriorityPill } from '@/components/ui/status-pill'
import { isWorkOrderStale, getStaleDurationHours } from '@/lib/kanban-helpers'
import type { WorkOrderWithOpsDTO } from '@/lib/repo'
import type { WorkOrderState } from '@savorg/core'
import { Clock } from 'lucide-react'

interface KanbanCardProps {
  workOrder: WorkOrderWithOpsDTO
  onClick: () => void
}

export function KanbanCard({ workOrder, onClick }: KanbanCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: workOrder.id,
    data: {
      type: 'work-order',
      workOrder,
      column: workOrder.state as WorkOrderState,
    },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  // Calculate operations progress
  const doneOps = workOrder.operations.filter((op) => op.status === 'done').length
  const totalOps = workOrder.operations.length
  const progressPercent = totalOps > 0 ? Math.round((doneOps / totalOps) * 100) : 0

  // Check if work order is stale
  const isStale = isWorkOrderStale(workOrder)
  const staleHours = isStale ? getStaleDurationHours(workOrder) : 0
  const staleDays = Math.floor(staleHours / 24)

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        // Prevent click during/after drag
        if (!isDragging) {
          e.stopPropagation()
          onClick()
        }
      }}
      className={cn(
        'p-3 bg-bg-2 border border-white/[0.06] rounded-[var(--radius-md)]',
        'cursor-grab active:cursor-grabbing',
        'transition-all duration-150',
        'hover:border-bd-1 hover:bg-bg-3/50',
        'select-none touch-none',
        isDragging && 'opacity-50 shadow-lg ring-2 ring-status-info/50 z-50',
        // Subtle stale indicator border
        isStale && 'border-l-2 border-l-status-warning/60'
      )}
      data-dragging={isDragging}
    >
      {/* Header: Code + Priority */}
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-xs font-medium text-fg-1">
          {workOrder.code}
        </span>
        <PriorityPill priority={workOrder.priority} />
      </div>

      {/* Title */}
      <p className="text-sm text-fg-0 line-clamp-2 mb-2 leading-snug">
        {workOrder.title}
      </p>

      {/* Progress Bar (only if has operations) */}
      {totalOps > 0 && (
        <div className="mb-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-fg-2">{doneOps}/{totalOps} ops</span>
            <span className="text-[11px] text-fg-2">{progressPercent}%</span>
          </div>
          <div className="h-1 bg-bg-3 rounded-full overflow-hidden">
            <div
              className="h-full bg-status-success transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Footer: Updated time + Stale/Owner badges */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-fg-2 flex-shrink-0">
          {formatRelativeTime(workOrder.updatedAt)}
        </span>
        <div className="flex items-center gap-1.5">
          {isStale && (
            <span
              className="flex items-center gap-1 text-[10px] font-medium text-status-warning px-1.5 py-0.5 rounded bg-status-warning/10"
              title={`No updates in ${staleDays > 0 ? `${staleDays}d` : `${staleHours}h`}`}
            >
              <Clock className="w-2.5 h-2.5" />
              {staleDays > 0 ? `${staleDays}d` : `${staleHours}h`}
            </span>
          )}
          {workOrder.owner === 'savorgceo' && (
            <span className="text-[10px] font-mono font-medium text-status-progress px-1.5 py-0.5 rounded bg-status-progress/10">
              CEO
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Card variant for drag overlay (ghost card shown while dragging)
 */
export function KanbanCardOverlay({ workOrder }: { workOrder: WorkOrderWithOpsDTO }) {
  const doneOps = workOrder.operations.filter((op) => op.status === 'done').length
  const totalOps = workOrder.operations.length
  const progressPercent = totalOps > 0 ? Math.round((doneOps / totalOps) * 100) : 0

  return (
    <div
      className={cn(
        'p-3 bg-bg-2 border border-white/[0.06] rounded-[var(--radius-md)]',
        'shadow-2xl ring-2 ring-status-info/50',
        'cursor-grabbing',
        'rotate-2 scale-105',
        'w-[200px]' // Reasonable overlay width
      )}
    >
      {/* Header: Code + Priority */}
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-xs font-medium text-fg-1">
          {workOrder.code}
        </span>
        <PriorityPill priority={workOrder.priority} />
      </div>

      {/* Title */}
      <p className="text-sm text-fg-0 line-clamp-2 mb-2 leading-snug">
        {workOrder.title}
      </p>

      {/* Progress Bar */}
      {totalOps > 0 && (
        <div className="mb-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-fg-2">{doneOps}/{totalOps} ops</span>
            <span className="text-[11px] text-fg-2">{progressPercent}%</span>
          </div>
          <div className="h-1 bg-bg-3 rounded-full overflow-hidden">
            <div
              className="h-full bg-status-success"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-fg-2">
          {formatRelativeTime(workOrder.updatedAt)}
        </span>
        {workOrder.owner === 'savorgceo' && (
          <span className="text-[10px] font-mono font-medium text-status-progress px-1.5 py-0.5 rounded bg-status-progress/10">
            CEO
          </span>
        )}
      </div>
    </div>
  )
}
