/**
 * Kanban Board Helpers
 *
 * Utilities for validating drag-drop state transitions and
 * integrating with the Governor policy system.
 */

import type { WorkOrderState } from '@clawcontrol/core'
import {
  canTransitionWorkOrder,
  getValidWorkOrderTransitions,
  ACTION_POLICIES,
  type ActionKind,
} from '@clawcontrol/core'
import type { StatusTone } from '@clawcontrol/ui/theme'

// ============================================================================
// CONSTANTS
// ============================================================================

/** Threshold for "stale" indicator (hours without update) */
export const STALE_THRESHOLD_HOURS = 24

// ============================================================================
// COLUMN CONFIGURATION
// ============================================================================

export interface KanbanColumnConfig {
  state: WorkOrderState
  label: string
  tone: StatusTone
  /** Whether this column is a dangerous drop target (shows warning) */
  isDangerous?: boolean
}

/**
 * Kanban columns in display order.
 * All states are now mapped - cancelled shows as "Archive"
 */
export const KANBAN_COLUMNS: KanbanColumnConfig[] = [
  { state: 'planned', label: 'Planned', tone: 'idle' },
  { state: 'active', label: 'Active', tone: 'progress' },
  { state: 'review', label: 'Review', tone: 'warning' },
  { state: 'blocked', label: 'Blocked', tone: 'danger' },
  { state: 'shipped', label: 'Shipped', tone: 'success', isDangerous: true },
  { state: 'archived', label: 'Archive', tone: 'muted', isDangerous: true },
]

/**
 * All states shown on the board.
 */
export const BOARD_STATES: WorkOrderState[] = KANBAN_COLUMNS.map((c) => c.state)

/**
 * Resolve actual transition state from a drop column.
 *
 * Archive column is a shared sink:
 * - shipped -> archived
 * - cancellable non-shipped states -> cancelled
 */
export function resolveDropTargetState(
  fromState: WorkOrderState,
  toColumnState: WorkOrderState
): WorkOrderState | null {
  if (toColumnState !== 'archived') return toColumnState
  if (fromState === 'shipped') return 'archived'
  if (fromState === 'archived' || fromState === 'cancelled') return fromState
  if (canTransitionWorkOrder(fromState, 'cancelled')) return 'cancelled'
  if (canTransitionWorkOrder(fromState, 'archived')) return 'archived'
  return null
}

// ============================================================================
// DROP VALIDATION
// ============================================================================

export type DropIndicator = 'valid' | 'invalid' | 'protected'

export interface DropValidation {
  valid: boolean
  requiresConfirmation: boolean
  actionKind?: ActionKind
  error?: string
}

/**
 * Validate a drag-drop transition between columns.
 *
 * @returns Validation result with:
 *   - valid: whether the drop is allowed
 *   - requiresConfirmation: whether TypedConfirmModal should show
 *   - actionKind: the Governor action kind (for protected transitions)
 *   - error: human-readable error message if invalid
 */
export function validateKanbanDrop(
  fromState: WorkOrderState,
  toColumnState: WorkOrderState
): DropValidation {
  const toState = resolveDropTargetState(fromState, toColumnState)

  if (!toState) {
    return {
      valid: false,
      requiresConfirmation: false,
      error: `Cannot move from ${fromState} to ${toColumnState}.`,
    }
  }

  // Same column = no-op
  if (fromState === toState) {
    return { valid: false, requiresConfirmation: false }
  }

  // Check state machine allows this transition
  if (!canTransitionWorkOrder(fromState, toState)) {
    const validTargets = getValidWorkOrderTransitions(fromState)
    const validStr = validTargets.length > 0 ? validTargets.join(', ') : 'none (terminal state)'
    return {
      valid: false,
      requiresConfirmation: false,
      error: `Cannot move from ${fromState} to ${toState}. Valid transitions: ${validStr}`,
    }
  }

  // Protected transitions (require TypedConfirmModal)
  if (toState === 'shipped') {
    return {
      valid: true,
      requiresConfirmation: true,
      actionKind: 'work_order.ship',
    }
  }

  if (toState === 'cancelled') {
    return {
      valid: true,
      requiresConfirmation: true,
      actionKind: 'work_order.cancel',
    }
  }

  // Normal transition - allowed without confirmation
  return { valid: true, requiresConfirmation: false }
}

/**
 * Check if a column can accept a drop from a given source state.
 * Used for dimming invalid columns during drag.
 */
export function canColumnAcceptDrop(
  fromState: WorkOrderState,
  targetColumnState: WorkOrderState
): boolean {
  const targetState = resolveDropTargetState(fromState, targetColumnState)
  if (!targetState) return false
  if (fromState === targetState) return false
  return canTransitionWorkOrder(fromState, targetState)
}

/**
 * Get all valid target columns for a given source state.
 * Used to determine which columns to dim during drag.
 */
export function getValidTargetColumns(fromState: WorkOrderState): WorkOrderState[] {
  return KANBAN_COLUMNS
    .map((column) => column.state)
    .filter((column) => canColumnAcceptDrop(fromState, column))
}

/**
 * Get drop indicator for visual feedback during drag.
 */
export function getDropIndicator(
  fromState: WorkOrderState,
  toColumnState: WorkOrderState
): DropIndicator {
  const result = validateKanbanDrop(fromState, toColumnState)
  if (!result.valid) return 'invalid'
  if (result.requiresConfirmation) return 'protected'
  return 'valid'
}

/**
 * Get the description for a protected action.
 */
export function getProtectedActionDescription(actionKind: ActionKind): string {
  return ACTION_POLICIES[actionKind].description
}

// ============================================================================
// STALE DETECTION
// ============================================================================

/**
 * Check if a work order is "stale" (no updates in threshold period).
 * Only applies to active/in-progress states.
 */
export function isWorkOrderStale(
  workOrder: { state: string; updatedAt: Date | string },
  thresholdHours: number = STALE_THRESHOLD_HOURS
): boolean {
  // Only check stale status for active-ish states
  const staleCheckStates = ['active', 'blocked', 'review']
  if (!staleCheckStates.includes(workOrder.state)) {
    return false
  }

  const updatedAt = typeof workOrder.updatedAt === 'string'
    ? new Date(workOrder.updatedAt)
    : workOrder.updatedAt

  const now = new Date()
  const hoursSinceUpdate = (now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60)

  return hoursSinceUpdate > thresholdHours
}

/**
 * Get stale duration in hours.
 */
export function getStaleDurationHours(
  workOrder: { updatedAt: Date | string }
): number {
  const updatedAt = typeof workOrder.updatedAt === 'string'
    ? new Date(workOrder.updatedAt)
    : workOrder.updatedAt

  const now = new Date()
  return Math.floor((now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60))
}

// ============================================================================
// GROUPING & SORTING
// ============================================================================

/**
 * Group work orders by state for Kanban columns.
 */
export function groupByState<T extends { state: WorkOrderState }>(
  items: T[]
): Record<WorkOrderState, T[]> {
  const groups: Record<WorkOrderState, T[]> = {
    planned: [],
    active: [],
    blocked: [],
    review: [],
    shipped: [],
    archived: [],
    cancelled: [],
  }

  for (const item of items) {
    if (item.state === 'archived' || item.state === 'cancelled') {
      groups.archived.push(item)
      continue
    }
    groups[item.state].push(item)
  }

  return groups
}

/**
 * Sort work orders within a column.
 * Order: Priority (P0 first) → Most recently updated
 */
export function sortWorkOrdersInColumn<
  T extends { priority: string; updatedAt: Date | string }
>(items: T[]): T[] {
  const priorityOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 }

  return [...items].sort((a, b) => {
    // Sort by priority first (P0 = highest)
    const aPriority = priorityOrder[a.priority] ?? 99
    const bPriority = priorityOrder[b.priority] ?? 99
    if (aPriority !== bPriority) return aPriority - bPriority

    // Then by most recently updated
    const aTime = typeof a.updatedAt === 'string' ? new Date(a.updatedAt).getTime() : a.updatedAt.getTime()
    const bTime = typeof b.updatedAt === 'string' ? new Date(b.updatedAt).getTime() : b.updatedAt.getTime()
    return bTime - aTime
  })
}
