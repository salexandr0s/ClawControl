/**
 * withGovernor - Route Handler Wrapper for Governor Enforcement
 *
 * Wraps API route handlers to enforce Governor policy at the server level.
 * This ensures that protected actions cannot bypass approval gates.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from './repo'
import {
  ACTION_POLICIES,
  validateTypedConfirm,
  type ActionKind,
  type ConfirmMode,
} from '@savorgos/core'
import {
  validateApprovalGate,
  type ApprovalGateResult,
} from './approval-gate'

// ============================================================================
// TYPES
// ============================================================================

export interface GovernorContext {
  actionKind: ActionKind
  workOrderId: string
  operationId?: string | null
  actor: string
  typedConfirmText?: string
  gateResult: ApprovalGateResult
}

export interface GovernorRequest {
  /** The action kind to enforce */
  actionKind: ActionKind
  /** Extract work order ID from request (required for approval lookup) */
  getWorkOrderId: (request: NextRequest, body?: unknown) => string | null
  /** Extract operation ID from request (optional) */
  getOperationId?: (request: NextRequest, body?: unknown) => string | null
  /** Extract actor from request (defaults to 'user') */
  getActor?: (request: NextRequest, body?: unknown) => string
  /** Skip approval gate check (useful for safe actions that still need typed confirm) */
  skipApprovalGate?: boolean
}

export interface GovernorError {
  error: string
  code: 'APPROVAL_REQUIRED' | 'APPROVAL_PENDING' | 'APPROVAL_REJECTED' | 'TYPED_CONFIRM_REQUIRED' | 'TYPED_CONFIRM_INVALID'
  details?: {
    actionKind: ActionKind
    confirmMode?: ConfirmMode
    approvalId?: string
    required?: string
  }
}

type RouteHandler<T = unknown> = (
  request: NextRequest,
  context: { params: Promise<Record<string, string>> },
  governorContext: GovernorContext
) => Promise<NextResponse<T>>

// ============================================================================
// WRAPPER
// ============================================================================

/**
 * Wrap a route handler with Governor enforcement.
 *
 * This ensures:
 * 1. Approval gate is checked (if action requires approval)
 * 2. Typed confirmation is validated server-side
 * 3. Activity is logged on execution
 *
 * @example
 * export const PATCH = withGovernor(
 *   {
 *     actionKind: 'work_order.ship',
 *     getWorkOrderId: (_, body) => body.workOrderId,
 *   },
 *   async (request, context, governorContext) => {
 *     // Handler runs only if approval + typed confirm pass
 *     return NextResponse.json({ success: true })
 *   }
 * )
 */
export function withGovernor<T>(
  config: GovernorRequest,
  handler: RouteHandler<T>
): (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<NextResponse<T | GovernorError>> {
  return async (request, context) => {
    const policy = ACTION_POLICIES[config.actionKind]

    // Parse body for POST/PATCH/PUT/DELETE requests
    let body: unknown = undefined
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) {
      try {
        body = await request.clone().json()
      } catch {
        // Body might be empty or not JSON
      }
    }

    // Extract identifiers
    const workOrderId = config.getWorkOrderId(request, body)
    if (!workOrderId && policy.requiresApproval) {
      return NextResponse.json(
        {
          error: 'Work order ID is required for this action',
          code: 'APPROVAL_REQUIRED' as const,
          details: { actionKind: config.actionKind },
        },
        { status: 400 }
      )
    }

    const operationId = config.getOperationId?.(request, body) ?? null
    const actor = config.getActor?.(request, body) ?? 'user'

    // Extract typed confirm text from body
    const typedConfirmText = typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>).typedConfirmText as string | undefined
      : undefined

    // 1. Check approval gate (if required)
    let gateResult: ApprovalGateResult = {
      allowed: true,
      reason: 'no_approval_required',
      policy,
    }

    if (workOrderId && policy.requiresApproval && !config.skipApprovalGate) {
      gateResult = await validateApprovalGate({
        actionKind: config.actionKind,
        workOrderId,
        operationId,
      })

      if (!gateResult.allowed) {
        const repos = getRepos()

        // Log denied attempt
        await repos.activities.create({
          type: 'governor.denied',
          actor,
          entityType: 'work_order',
          entityId: workOrderId,
          summary: `Action denied: ${policy.description}`,
          payloadJson: {
            actionKind: config.actionKind,
            reason: gateResult.reason,
            approvalId: gateResult.approval?.id,
          },
        })

        // Return appropriate error
        if (gateResult.reason === 'missing') {
          return NextResponse.json(
            {
              error: `Action "${policy.description}" requires approval`,
              code: 'APPROVAL_REQUIRED' as const,
              details: {
                actionKind: config.actionKind,
                confirmMode: policy.confirmMode,
              },
            },
            { status: 403 }
          )
        }

        if (gateResult.reason === 'pending') {
          return NextResponse.json(
            {
              error: `Action "${policy.description}" is awaiting approval`,
              code: 'APPROVAL_PENDING' as const,
              details: {
                actionKind: config.actionKind,
                approvalId: gateResult.approval?.id,
              },
            },
            { status: 403 }
          )
        }

        if (gateResult.reason === 'rejected') {
          return NextResponse.json(
            {
              error: `Action "${policy.description}" was rejected`,
              code: 'APPROVAL_REJECTED' as const,
              details: {
                actionKind: config.actionKind,
                approvalId: gateResult.approval?.id,
              },
            },
            { status: 403 }
          )
        }
      }
    }

    // 2. Validate typed confirmation (if required)
    if (policy.confirmMode !== 'NONE') {
      // For WO_CODE mode, we need to fetch the work order code
      let workOrderCode: string | undefined
      if (policy.confirmMode === 'WO_CODE' && workOrderId) {
        const repos = getRepos()
        const wo = await repos.workOrders.getById(workOrderId)
        workOrderCode = wo?.code
      }

      // Check if typed confirm is required but missing
      if (!typedConfirmText) {
        return NextResponse.json(
          {
            error: `Typed confirmation required for "${policy.description}"`,
            code: 'TYPED_CONFIRM_REQUIRED' as const,
            details: {
              actionKind: config.actionKind,
              confirmMode: policy.confirmMode,
              required: policy.confirmMode === 'WO_CODE' ? workOrderCode : 'CONFIRM',
            },
          },
          { status: 403 }
        )
      }

      // Validate the typed confirm value
      const validation = validateTypedConfirm(policy.confirmMode, typedConfirmText, workOrderCode)
      if (!validation.valid) {
        return NextResponse.json(
          {
            error: validation.error || 'Invalid confirmation',
            code: 'TYPED_CONFIRM_INVALID' as const,
            details: {
              actionKind: config.actionKind,
              confirmMode: policy.confirmMode,
              required: policy.confirmMode === 'WO_CODE' ? workOrderCode : 'CONFIRM',
            },
          },
          { status: 403 }
        )
      }
    }

    // 3. Execute the handler
    const governorContext: GovernorContext = {
      actionKind: config.actionKind,
      workOrderId: workOrderId!,
      operationId,
      actor,
      typedConfirmText,
      gateResult,
    }

    const result = await handler(request, context, governorContext)

    // 4. Log successful execution
    if (workOrderId) {
      const repos = getRepos()
      await repos.activities.create({
        type: 'governor.executed',
        actor,
        entityType: 'work_order',
        entityId: workOrderId,
        summary: `Action executed: ${policy.description}`,
        payloadJson: {
          actionKind: config.actionKind,
          approvalId: gateResult.approval?.id,
          riskLevel: policy.riskLevel,
        },
      })
    }

    return result
  }
}

// ============================================================================
// HELPER: Simple enforcement without full wrapper
// ============================================================================

/**
 * Standalone function to enforce Governor policy.
 * Use this when you can't use the wrapper pattern.
 */
export async function enforceGovernor(params: {
  actionKind: ActionKind
  workOrderId: string
  operationId?: string | null
  actor: string
  typedConfirmText?: string
}): Promise<{ allowed: true; gateResult: ApprovalGateResult } | { allowed: false; error: GovernorError; status: number }> {
  const { actionKind, workOrderId, operationId, actor, typedConfirmText } = params
  const policy = ACTION_POLICIES[actionKind]
  const repos = getRepos()

  // Check approval gate
  if (policy.requiresApproval) {
    const gateResult = await validateApprovalGate({
      actionKind,
      workOrderId,
      operationId,
    })

    if (!gateResult.allowed) {
      await repos.activities.create({
        type: 'governor.denied',
        actor,
        entityType: 'work_order',
        entityId: workOrderId,
        summary: `Action denied: ${policy.description}`,
        payloadJson: {
          actionKind,
          reason: gateResult.reason,
          approvalId: gateResult.approval?.id,
        },
      })

      if (gateResult.reason === 'missing') {
        return {
          allowed: false,
          error: {
            error: `Action "${policy.description}" requires approval`,
            code: 'APPROVAL_REQUIRED',
            details: { actionKind, confirmMode: policy.confirmMode },
          },
          status: 403,
        }
      }

      if (gateResult.reason === 'pending') {
        return {
          allowed: false,
          error: {
            error: `Action "${policy.description}" is awaiting approval`,
            code: 'APPROVAL_PENDING',
            details: { actionKind, approvalId: gateResult.approval?.id },
          },
          status: 403,
        }
      }

      return {
        allowed: false,
        error: {
          error: `Action "${policy.description}" was rejected`,
          code: 'APPROVAL_REJECTED',
          details: { actionKind, approvalId: gateResult.approval?.id },
        },
        status: 403,
      }
    }
  }

  // Check typed confirmation
  if (policy.confirmMode !== 'NONE') {
    let workOrderCode: string | undefined
    if (policy.confirmMode === 'WO_CODE') {
      const wo = await repos.workOrders.getById(workOrderId)
      workOrderCode = wo?.code
    }

    if (!typedConfirmText) {
      return {
        allowed: false,
        error: {
          error: `Typed confirmation required for "${policy.description}"`,
          code: 'TYPED_CONFIRM_REQUIRED',
          details: {
            actionKind,
            confirmMode: policy.confirmMode,
            required: policy.confirmMode === 'WO_CODE' ? workOrderCode : 'CONFIRM',
          },
        },
        status: 403,
      }
    }

    const validation = validateTypedConfirm(policy.confirmMode, typedConfirmText, workOrderCode)
    if (!validation.valid) {
      return {
        allowed: false,
        error: {
          error: validation.error || 'Invalid confirmation',
          code: 'TYPED_CONFIRM_INVALID',
          details: {
            actionKind,
            confirmMode: policy.confirmMode,
            required: policy.confirmMode === 'WO_CODE' ? workOrderCode : 'CONFIRM',
          },
        },
        status: 403,
      }
    }
  }

  return {
    allowed: true,
    gateResult: {
      allowed: true,
      reason: policy.requiresApproval ? 'approved' : 'no_approval_required',
      policy,
    },
  }
}

// ============================================================================
// HELPER: Typed Confirm Only (no approval gate)
// ============================================================================

/**
 * Simplified enforcement for actions that only need typed confirmation
 * but don't require work order approval gates (e.g., config file edits).
 */
export async function enforceTypedConfirm(params: {
  actionKind: ActionKind
  typedConfirmText?: string
}): Promise<{ allowed: true; policy: typeof ACTION_POLICIES[ActionKind] } | { allowed: false; errorType: string; policy: typeof ACTION_POLICIES[ActionKind] }> {
  const { actionKind, typedConfirmText } = params
  const policy = ACTION_POLICIES[actionKind]

  // For actions with no confirmation required, allow immediately
  if (policy.confirmMode === 'NONE') {
    return { allowed: true, policy }
  }

  // Check typed confirmation
  if (!typedConfirmText) {
    return {
      allowed: false,
      errorType: 'TYPED_CONFIRM_REQUIRED',
      policy,
    }
  }

  // Validate - for CONFIRM mode, just check if it matches
  if (policy.confirmMode === 'CONFIRM') {
    const validation = validateTypedConfirm('CONFIRM', typedConfirmText)
    if (!validation.valid) {
      return {
        allowed: false,
        errorType: 'TYPED_CONFIRM_INVALID',
        policy,
      }
    }
  }

  return { allowed: true, policy }
}
