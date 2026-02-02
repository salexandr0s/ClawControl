/**
 * Server-side Approval Gate
 *
 * Enforces approval requirements based on Governor policy.
 * This module provides helpers to check, create, and validate approvals
 * before executing protected actions.
 */

import { getRepos } from './repo'
import type { ApprovalDTO } from './repo'
import {
  ACTION_POLICIES,
  type ActionKind,
  type ActionPolicy,
  type ApprovalType,
} from '@savorgos/core'

// ============================================================================
// TYPES
// ============================================================================

export interface ApprovalGateResult {
  allowed: boolean
  reason: 'no_approval_required' | 'approved' | 'pending' | 'rejected' | 'missing'
  approval?: ApprovalDTO
  policy: ActionPolicy
}

export interface CreateApprovalGateInput {
  actionKind: ActionKind
  workOrderId: string
  operationId?: string | null
  questionMd: string
  actor?: string
}

export interface ValidateApprovalInput {
  actionKind: ActionKind
  workOrderId: string
  operationId?: string | null
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Get the policy for an action kind
 */
export function getActionPolicy(actionKind: ActionKind): ActionPolicy {
  return ACTION_POLICIES[actionKind]
}

/**
 * Check if an action requires approval based on Governor policy
 */
export function requiresApproval(actionKind: ActionKind): boolean {
  const policy = ACTION_POLICIES[actionKind]
  return policy.requiresApproval
}

/**
 * Get the approval type for an action kind
 */
export function getApprovalType(actionKind: ActionKind): ApprovalType | undefined {
  const policy = ACTION_POLICIES[actionKind]
  return policy.approvalType
}

// ============================================================================
// APPROVAL GATE FUNCTIONS
// ============================================================================

/**
 * Validate that an action is allowed based on approval status.
 * Returns the gate result with approval status and policy.
 *
 * Use this before executing protected actions to ensure approvals exist.
 */
export async function validateApprovalGate(
  input: ValidateApprovalInput
): Promise<ApprovalGateResult> {
  const { actionKind, workOrderId, operationId } = input
  const policy = ACTION_POLICIES[actionKind]

  // If no approval required, allow immediately
  if (!policy.requiresApproval || !policy.approvalType) {
    return {
      allowed: true,
      reason: 'no_approval_required',
      policy,
    }
  }

  const repos = getRepos()

  // Look for existing approvals for this action
  const approvals = await repos.approvals.list({
    workOrderId,
    type: policy.approvalType,
  })

  // Find matching approval (considering operationId if provided)
  const matchingApproval = approvals.find((a) => {
    if (operationId) {
      return a.operationId === operationId
    }
    // For work order level actions, operationId should be null
    return a.operationId === null
  })

  if (!matchingApproval) {
    return {
      allowed: false,
      reason: 'missing',
      policy,
    }
  }

  if (matchingApproval.status === 'pending') {
    return {
      allowed: false,
      reason: 'pending',
      approval: matchingApproval,
      policy,
    }
  }

  if (matchingApproval.status === 'rejected') {
    return {
      allowed: false,
      reason: 'rejected',
      approval: matchingApproval,
      policy,
    }
  }

  // Status is 'approved'
  return {
    allowed: true,
    reason: 'approved',
    approval: matchingApproval,
    policy,
  }
}

/**
 * Create an approval request for a protected action.
 * Returns the existing approval if one already exists (idempotent).
 */
export async function createApprovalRequest(
  input: CreateApprovalGateInput
): Promise<{ approval: ApprovalDTO; created: boolean }> {
  const { actionKind, workOrderId, operationId, questionMd, actor } = input
  const policy = ACTION_POLICIES[actionKind]

  if (!policy.approvalType) {
    throw new Error(`Action ${actionKind} does not have an approval type configured`)
  }

  const repos = getRepos()

  // Check for existing pending approval (idempotency)
  const existingApprovals = await repos.approvals.list({
    workOrderId,
    type: policy.approvalType,
    status: 'pending',
  })

  const existingPending = existingApprovals.find(
    (a) => a.operationId === (operationId || null)
  )

  if (existingPending) {
    return { approval: existingPending, created: false }
  }

  // Create new approval request
  const approval = await repos.approvals.create({
    workOrderId,
    operationId: operationId || null,
    type: policy.approvalType,
    questionMd,
  })

  // Log activity
  await repos.activities.create({
    type: 'approval.requested',
    actor: actor || 'system',
    entityType: 'approval',
    entityId: approval.id,
    summary: `Approval requested: ${policy.description}`,
    payloadJson: {
      actionKind,
      workOrderId,
      operationId,
      approvalType: policy.approvalType,
      riskLevel: policy.riskLevel,
    },
  })

  return { approval, created: true }
}

/**
 * Ensure an approval exists for an action. Creates one if missing.
 * This is a convenience wrapper around validateApprovalGate and createApprovalRequest.
 *
 * Returns the gate result. If approval was missing and created, reason will be 'pending'.
 */
export async function ensureApprovalGate(
  input: CreateApprovalGateInput
): Promise<ApprovalGateResult> {
  const { actionKind, workOrderId, operationId, questionMd, actor } = input

  // First, validate current status
  const gateResult = await validateApprovalGate({
    actionKind,
    workOrderId,
    operationId,
  })

  // If already allowed or has existing approval (any status), return as-is
  if (gateResult.reason !== 'missing') {
    return gateResult
  }

  // Create the approval request
  const { approval } = await createApprovalRequest({
    actionKind,
    workOrderId,
    operationId,
    questionMd,
    actor,
  })

  return {
    allowed: false,
    reason: 'pending',
    approval,
    policy: gateResult.policy,
  }
}

/**
 * Assert that an action is allowed. Throws if not allowed.
 * Use this as a guard before executing protected actions.
 */
export async function assertApprovalGate(
  input: ValidateApprovalInput
): Promise<ApprovalDTO | null> {
  const result = await validateApprovalGate(input)

  if (!result.allowed) {
    const policy = result.policy
    // When allowed is false, reason can only be 'pending', 'rejected', or 'missing'
    const reason = result.reason as 'pending' | 'rejected' | 'missing'
    throw new ApprovalGateError(
      reason,
      input.actionKind,
      policy.description,
      result.approval
    )
  }

  return result.approval || null
}

// ============================================================================
// ERROR CLASS
// ============================================================================

export class ApprovalGateError extends Error {
  constructor(
    public reason: 'pending' | 'rejected' | 'missing',
    public actionKind: ActionKind,
    public actionDescription: string,
    public approval?: ApprovalDTO
  ) {
    const message =
      reason === 'pending'
        ? `Action "${actionDescription}" is awaiting approval`
        : reason === 'rejected'
        ? `Action "${actionDescription}" was rejected`
        : `Action "${actionDescription}" requires approval`
    super(message)
    this.name = 'ApprovalGateError'
  }
}
