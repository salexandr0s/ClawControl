'use client'

import { useState, useMemo, useCallback } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { cn } from '@/lib/utils'
import type { WorkOrderState } from '@savorg/core'
import type { WorkOrderWithOpsDTO } from '@/lib/repo'
import {
  KANBAN_COLUMNS,
  groupByState,
  sortWorkOrdersInColumn,
  validateKanbanDrop,
  getDropIndicator,
  canColumnAcceptDrop,
  type DropIndicator,
} from '@/lib/kanban-helpers'
import { useProtectedActionTrigger } from '@/components/protected-action-modal'
import { KanbanColumn } from './kanban-column'
import { KanbanCardOverlay } from './kanban-card'

interface KanbanBoardProps {
  workOrders: WorkOrderWithOpsDTO[]
  onWorkOrderClick: (wo: WorkOrderWithOpsDTO) => void
  onStateChange: (
    id: string,
    newState: WorkOrderState,
    typedConfirmText?: string
  ) => Promise<void>
}

export function KanbanBoard({
  workOrders,
  onWorkOrderClick,
  onStateChange,
}: KanbanBoardProps) {
  const triggerProtectedAction = useProtectedActionTrigger()

  // Track active drag state
  const [activeWorkOrder, setActiveWorkOrder] = useState<WorkOrderWithOpsDTO | null>(null)
  const [activeColumn, setActiveColumn] = useState<WorkOrderState | null>(null)
  const [overColumn, setOverColumn] = useState<WorkOrderState | null>(null)

  // Group and sort work orders by state
  const groupedWorkOrders = useMemo(() => {
    const grouped = groupByState(workOrders)
    // Sort each column
    for (const state of Object.keys(grouped) as WorkOrderState[]) {
      grouped[state] = sortWorkOrdersInColumn(grouped[state])
    }
    return grouped
  }, [workOrders])

  // Configure drag sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Minimum drag distance before activation
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Find work order by ID
  const findWorkOrder = useCallback(
    (id: string): WorkOrderWithOpsDTO | undefined => {
      return workOrders.find((wo) => wo.id === id)
    },
    [workOrders]
  )

  // Get drop indicator for current drag state
  const getColumnDropIndicator = useCallback(
    (columnState: WorkOrderState): DropIndicator | undefined => {
      if (!activeColumn || !overColumn) return undefined
      if (columnState !== overColumn) return undefined
      return getDropIndicator(activeColumn, overColumn)
    },
    [activeColumn, overColumn]
  )

  // Handle drag start
  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const workOrder = findWorkOrder(event.active.id as string)
      if (workOrder) {
        setActiveWorkOrder(workOrder)
        setActiveColumn(workOrder.state as WorkOrderState)
      }
    },
    [findWorkOrder]
  )

  // Handle drag over (for visual feedback)
  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { over } = event
    if (!over) {
      setOverColumn(null)
      return
    }

    // Check if over a column directly
    const overData = over.data.current
    if (overData?.type === 'column') {
      setOverColumn(overData.column as WorkOrderState)
    } else if (overData?.type === 'work-order') {
      // Over a card - use its column
      setOverColumn(overData.column as WorkOrderState)
    }
  }, [])

  // Handle drag end
  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event

      // Reset drag state
      setActiveWorkOrder(null)
      setActiveColumn(null)
      setOverColumn(null)

      if (!over) return

      const workOrderId = active.id as string
      const workOrder = findWorkOrder(workOrderId)
      if (!workOrder) return

      const fromState = workOrder.state as WorkOrderState

      // Determine target column
      const overData = over.data.current
      let toState: WorkOrderState

      if (overData?.type === 'column') {
        toState = overData.column as WorkOrderState
      } else if (overData?.type === 'work-order') {
        toState = overData.column as WorkOrderState
      } else {
        return
      }

      // Validate the transition
      const validation = validateKanbanDrop(fromState, toState)

      if (!validation.valid) {
        // Could show a toast here with validation.error
        console.warn('Invalid transition:', validation.error)
        return
      }

      // Protected transition - show confirmation modal
      if (validation.requiresConfirmation && validation.actionKind) {
        triggerProtectedAction({
          actionKind: validation.actionKind,
          actionTitle: toState === 'shipped' ? 'Ship Work Order' : 'Cancel Work Order',
          actionDescription: `Move ${workOrder.code} to ${toState}. ${
            toState === 'shipped'
              ? 'This will mark the work order as complete.'
              : 'This action cannot be undone.'
          }`,
          workOrderCode: workOrder.code,
          entityName: workOrder.title,
          onConfirm: async (typedConfirmText) => {
            await onStateChange(workOrderId, toState, typedConfirmText)
          },
          onError: (error) => {
            console.error('Failed to change state:', error)
          },
        })
        return
      }

      // Normal transition - execute directly
      try {
        await onStateChange(workOrderId, toState)
      } catch (error) {
        console.error('Failed to change state:', error)
      }
    },
    [findWorkOrder, onStateChange, triggerProtectedAction]
  )

  // Handle drag cancel
  const handleDragCancel = useCallback(() => {
    setActiveWorkOrder(null)
    setActiveColumn(null)
    setOverColumn(null)
  }, [])

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div
        className={cn(
          // Fill available height (parent should set height context)
          'flex h-full min-h-0',
          // Columns fill width until min-width threshold, then scroll
          'gap-3 overflow-x-auto pb-2',
          'snap-x snap-mandatory',
          'scrollbar-hide'
        )}
      >
        {KANBAN_COLUMNS.map((column) => (
          <KanbanColumn
            key={column.state}
            id={column.state}
            label={column.label}
            tone={column.tone}
            isDangerous={column.isDangerous}
            workOrders={groupedWorkOrders[column.state] || []}
            onCardClick={onWorkOrderClick}
            dropIndicator={getColumnDropIndicator(column.state)}
            canAcceptDrop={
              activeColumn
                ? canColumnAcceptDrop(activeColumn, column.state)
                : undefined
            }
            isDragging={activeColumn !== null}
          />
        ))}
      </div>

      {/* Drag Overlay - ghost card following cursor */}
      <DragOverlay>
        {activeWorkOrder && (
          <KanbanCardOverlay workOrder={activeWorkOrder} />
        )}
      </DragOverlay>
    </DndContext>
  )
}
