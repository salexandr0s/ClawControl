import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'
import { enforceGovernor } from '@/lib/with-governor'
import { getRequestActor } from '@/lib/request-actor'
import { asAuthErrorResponse, verifyOperatorRequest } from '@/lib/auth/operator-auth'
import {
  validateWorkOrderTransition,
  getValidWorkOrderTransitions,
  type WorkOrderState,
  type ActionKind,
} from '@clawcontrol/core'

interface RouteContext {
  params: Promise<{ id: string }>
}

// Map state transitions to Governor action kinds
const STATE_TO_ACTION: Record<string, ActionKind> = {
  shipped: 'work_order.ship',
  cancelled: 'work_order.cancel',
}
const WORK_ORDER_STATES = new Set<WorkOrderState>([
  'planned',
  'active',
  'blocked',
  'review',
  'shipped',
  'archived',
  'cancelled',
])

/**
 * GET /api/work-orders/:id
 *
 * Get a single work order with operations summary
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  const { id } = await context.params

  try {
    const repos = getRepos()
    const data = await repos.workOrders.getByIdWithOps(id)

    if (!data) {
      return NextResponse.json(
        { error: 'Work order not found' },
        { status: 404 }
      )
    }

    // Include allowed state transitions
    const allowedTransitions = getValidWorkOrderTransitions(data.state as WorkOrderState)

    return NextResponse.json({ data, allowedTransitions })
  } catch (error) {
    console.error('[api/work-orders/:id] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch work order' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/work-orders/:id
 *
 * Update a work order with state machine validation and Governor enforcement.
 *
 * For protected state transitions (ship, cancel), requires:
 * - typedConfirmText: The confirmation text (WO code or "CONFIRM")
 *
 * Returns 403 with structured error if Governor enforcement fails.
 */
export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  const { id } = await context.params

  try {
    const auth = verifyOperatorRequest(request, { requireCsrf: true })
    if (!auth.ok) {
      return NextResponse.json(asAuthErrorResponse(auth), { status: auth.status })
    }

    const body = await request.json()
    const {
      title,
      goalMd,
      state,
      priority,
      owner,
      ownerType,
      ownerAgentId,
      tags,
      blockedReason,
      typedConfirmText,
    } = body

    const repos = getRepos()
    const hasState = Object.prototype.hasOwnProperty.call(body, 'state')
    const nextState = hasState ? String(state ?? '').trim() : undefined
    const actorInfo = getRequestActor(request, {
      fallback: {
        actor: auth.principal.actor,
        actorType: 'user',
        actorId: auth.principal.actorId,
      },
    })

    // Always fetch current for comparison
    const current = await repos.workOrders.getById(id)
    if (!current) {
      return NextResponse.json(
        { error: 'Work order not found' },
        { status: 404 }
      )
    }

    if (hasState) {
      if (!nextState || !WORK_ORDER_STATES.has(nextState as WorkOrderState)) {
        return NextResponse.json(
          { error: `Invalid state: ${state}`, code: 'INVALID_STATE' },
          { status: 400 }
        )
      }
    }

    if (hasState && nextState === 'active') {
      return NextResponse.json(
        {
          error: 'Work order activation is manager-controlled',
          code: 'MANAGER_CONTROLLED_STATE',
        },
        { status: 400 }
      )
    }

    // If state is being changed to a different value, validate the transition
    const stateActuallyChanging = Boolean(hasState && nextState && nextState !== current.state)
    if (stateActuallyChanging) {
      const validation = validateWorkOrderTransition(
        current.state as WorkOrderState,
        nextState as WorkOrderState
      )

      if (!validation.valid) {
        return NextResponse.json(
          { error: validation.error, code: 'INVALID_TRANSITION' },
          { status: 400 }
        )
      }

      // Check if this transition requires Governor enforcement
      const actionKind = STATE_TO_ACTION[nextState as string]
      if (actionKind) {
        const governorResult = await enforceGovernor({
          actionKind,
          workOrderId: id,
          actor: actorInfo.actor,
          typedConfirmText,
        })

        if (!governorResult.allowed) {
          return NextResponse.json(governorResult.error, { status: governorResult.status })
        }
      }
    }

    // If state is actually changing, use atomic transaction
    if (stateActuallyChanging) {
      const result = await repos.workOrders.updateStateWithActivity(
        id,
        nextState as WorkOrderState,
        actorInfo.actor,
        actorInfo.actorType,
        actorInfo.actorType === 'agent' ? actorInfo.actorId ?? null : null
      )

      if (!result) {
        return NextResponse.json(
          { error: 'Failed to update work order' },
          { status: 500 }
        )
      }

      // If there are other updates beyond state, apply them separately
      if (
        title !== undefined ||
        goalMd !== undefined ||
        priority !== undefined ||
        owner !== undefined ||
        ownerType !== undefined ||
        ownerAgentId !== undefined ||
        tags !== undefined ||
        blockedReason !== undefined
      ) {
        const updated = await repos.workOrders.update(id, {
          title,
          goalMd,
          priority,
          owner,
          ownerType,
          ownerAgentId,
          tags,
          blockedReason,
        })
        return NextResponse.json({ data: updated })
      }

      return NextResponse.json({ data: result.workOrder })
    }

    // No state change - regular update without activity
    const data = await repos.workOrders.update(id, {
      title,
      goalMd,
      ...(hasState ? { state: nextState } : {}),
      priority,
      owner,
      ownerType,
      ownerAgentId,
      tags,
      blockedReason,
    })

    if (!data) {
      return NextResponse.json(
        { error: 'Failed to update work order' },
        { status: 500 }
      )
    }

    return NextResponse.json({ data })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('INVALID_WORK_ORDER_STATE')) {
      return NextResponse.json(
        { error: error.message, code: 'INVALID_STATE' },
        { status: 400 }
      )
    }
    console.error('[api/work-orders/:id] PATCH error:', error)
    return NextResponse.json(
      { error: 'Failed to update work order' },
      { status: 500 }
    )
  }
}
