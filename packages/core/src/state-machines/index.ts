/**
 * State machines for Work Orders and Operations
 */

import type { WorkOrderState, OperationStatus } from '../types'

// Work Order state machine
const WORK_ORDER_TRANSITIONS: Record<WorkOrderState, WorkOrderState[]> = {
  planned: ['active'],
  active: ['blocked', 'review', 'shipped', 'cancelled'],
  blocked: ['active', 'cancelled'],
  review: ['active', 'shipped'],
  shipped: [], // terminal
  cancelled: [], // terminal
}

export function canTransitionWorkOrder(
  from: WorkOrderState,
  to: WorkOrderState
): boolean {
  return WORK_ORDER_TRANSITIONS[from].includes(to)
}

export function getValidWorkOrderTransitions(
  from: WorkOrderState
): WorkOrderState[] {
  return WORK_ORDER_TRANSITIONS[from]
}

export function isWorkOrderTerminal(state: WorkOrderState): boolean {
  return state === 'shipped' || state === 'cancelled'
}

// Operation state machine
const OPERATION_TRANSITIONS: Record<OperationStatus, OperationStatus[]> = {
  todo: ['in_progress', 'blocked'],
  in_progress: ['review', 'done', 'blocked', 'rework'],
  review: ['done', 'rework'],
  blocked: ['todo', 'in_progress'],
  rework: ['todo', 'in_progress'],
  done: [], // terminal
}

export function canTransitionOperation(
  from: OperationStatus,
  to: OperationStatus
): boolean {
  return OPERATION_TRANSITIONS[from].includes(to)
}

export function getValidOperationTransitions(
  from: OperationStatus
): OperationStatus[] {
  return OPERATION_TRANSITIONS[from]
}

export function isOperationTerminal(status: OperationStatus): boolean {
  return status === 'done'
}

// Validation helpers
export function validateWorkOrderTransition(
  from: WorkOrderState,
  to: WorkOrderState
): { valid: boolean; error?: string } {
  if (from === to) {
    return { valid: false, error: `Already in state: ${from}` }
  }

  if (!canTransitionWorkOrder(from, to)) {
    const validTargets = getValidWorkOrderTransitions(from)
    return {
      valid: false,
      error: `Invalid transition: ${from} → ${to}. Valid targets: ${validTargets.join(', ') || 'none (terminal state)'}`,
    }
  }

  return { valid: true }
}

export function validateOperationTransition(
  from: OperationStatus,
  to: OperationStatus
): { valid: boolean; error?: string } {
  if (from === to) {
    return { valid: false, error: `Already in status: ${from}` }
  }

  if (!canTransitionOperation(from, to)) {
    const validTargets = getValidOperationTransitions(from)
    return {
      valid: false,
      error: `Invalid transition: ${from} → ${to}. Valid targets: ${validTargets.join(', ') || 'none (terminal status)'}`,
    }
  }

  return { valid: true }
}
