'use client'

import { useDroppable } from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { cn } from '@/lib/utils'
import type { StatusTone } from '@clawcontrol/ui/theme'
import { statusToneClasses } from '@clawcontrol/ui/theme'
import type { WorkOrderState } from '@clawcontrol/core'
import type { AgentDTO, WorkOrderWithOpsDTO } from '@/lib/repo'
import { KanbanCard } from './kanban-card'
import type { DropIndicator } from '@/lib/kanban-helpers'
import { AlertTriangle } from 'lucide-react'

interface KanbanColumnProps {
  id: WorkOrderState
  label: string
  tone: StatusTone
  isDangerous?: boolean
  workOrders: WorkOrderWithOpsDTO[]
  agents: AgentDTO[]
  onCardClick: (wo: WorkOrderWithOpsDTO) => void
  onAssignToAgent: (id: string, agentId: string) => Promise<void>
  assigningWorkOrderId?: string | null
  dropIndicator?: DropIndicator
  /** Whether this column can accept the currently dragged item */
  canAcceptDrop?: boolean
  /** Whether a drag is currently in progress */
  isDragging?: boolean
}

export function KanbanColumn({
  id,
  label,
  tone,
  isDangerous,
  workOrders,
  agents,
  onCardClick,
  onAssignToAgent,
  assigningWorkOrderId,
  dropIndicator,
  canAcceptDrop,
  isDragging,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: {
      type: 'column',
      column: id,
    },
  })

  const toneClasses = statusToneClasses[tone]
  const isBlockedColumn = id === 'blocked'
  const showBlockedAccent = isBlockedColumn && workOrders.length > 0
  const isTerminalColumn = id === 'shipped' || id === 'cancelled'

  // Determine if column should be dimmed (during drag, can't accept)
  const shouldDim = isDragging && canAcceptDrop === false

  // Determine border color based on drop indicator
  const getDropBorderClass = () => {
    if (!isOver || !dropIndicator) return ''
    switch (dropIndicator) {
      case 'valid':
        return 'border-status-info/50 bg-status-info/5 ring-2 ring-status-info/20'
      case 'protected':
        return 'border-status-warning/50 bg-status-warning/5 ring-2 ring-status-warning/20'
      case 'invalid':
        return 'border-status-danger/50 ring-2 ring-status-danger/20'
      default:
        return ''
    }
  }

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col',
        'snap-start',
        // Flexible width: grow to fill space, but scroll when below min-width
        // min-w-[180px] ensures columns don't get too narrow
        // flex-1 makes them share space equally
        // max-w-[320px] prevents columns from getting too wide on large screens
        'flex-1 min-w-[180px] max-w-[320px]',
        // Fill available height from parent
        'h-full min-h-[300px]',
        'bg-bg-1 rounded-[var(--radius-md)]',
        'border border-bd-0',
        'transition-all duration-200',
        // Blocked column gets a red accent only when there are blocked items.
        showBlockedAccent && 'border-l-2 border-l-status-danger',
        // Dim columns that can't accept the dragged item
        shouldDim && 'opacity-40 scale-[0.98]',
        // Drop target styling
        isOver && getDropBorderClass(),
        // Glow effect for valid drop targets during drag
        isDragging && canAcceptDrop && !isOver && 'ring-1 ring-white/[0.08]'
      )}
    >
      {/* Column Header - sticky within column */}
      <header
        className={cn(
          'sticky top-0 z-10',
          'flex items-center justify-between',
          'px-3 py-2.5',
          'bg-bg-1 rounded-t-[var(--radius-md)]',
          'border-b border-bd-0'
        )}
      >
        <div className="flex items-center gap-2">
          <span className="terminal-header">{label}</span>
          {isTerminalColumn && (
            <span className="text-[10px] text-fg-3">(terminal)</span>
          )}
          {/* Show warning icon for dangerous columns when drag is active */}
          {isDragging && canAcceptDrop && isDangerous && (
            <AlertTriangle className="w-3 h-3 text-status-warning animate-pulse" />
          )}
        </div>
        <span
          className={cn(
            'px-2 py-0.5 text-xs font-medium rounded-full',
            toneClasses.bg,
            toneClasses.text
          )}
        >
          {workOrders.length}
        </span>
      </header>

      {/* Cards container - scrollable */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 scrollbar-hide">
        <SortableContext
          items={workOrders.map((wo) => wo.id)}
          strategy={verticalListSortingStrategy}
        >
          {workOrders.map((workOrder) => (
            <KanbanCard
              key={workOrder.id}
              workOrder={workOrder}
              agents={agents}
              onClick={() => onCardClick(workOrder)}
              onAssignToAgent={onAssignToAgent}
              assigningWorkOrderId={assigningWorkOrderId}
            />
          ))}
        </SortableContext>

        {workOrders.length === 0 && (
          <div className="flex items-center justify-center h-24 text-xs text-fg-3">
            No work orders
          </div>
        )}
      </div>
    </div>
  )
}
