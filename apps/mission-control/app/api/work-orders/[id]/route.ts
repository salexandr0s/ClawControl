import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'
import { enforceGovernor } from '@/lib/with-governor'
import { getRequestActor } from '@/lib/request-actor'
import {
  validateWorkOrderTransition,
  getValidWorkOrderTransitions,
  type WorkOrderState,
  type ActionKind,
} from '@savorg/core'

interface RouteContext {
  params: Promise<{ id: string }>
}

// Map state transitions to Governor action kinds
const STATE_TO_ACTION: Record<string, ActionKind> = {
  shipped: 'work_order.ship',
  cancelled: 'work_order.cancel',
}

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
    const body = await request.json()
    const { title, goalMd, state, priority, owner, blockedReason, typedConfirmText } = body

    const repos = getRepos()
    const { actor } = getRequestActor(request)

    // Always fetch current for comparison
    const current = await repos.workOrders.getById(id)
    if (!current) {
      return NextResponse.json(
        { error: 'Work order not found' },
        { status: 404 }
      )
    }

    // If state is being changed to a different value, validate the transition
    const stateActuallyChanging = state && state !== current.state
    if (stateActuallyChanging) {
      const validation = validateWorkOrderTransition(
        current.state as WorkOrderState,
        state as WorkOrderState
      )

      if (!validation.valid) {
        return NextResponse.json(
          { error: validation.error, code: 'INVALID_TRANSITION' },
          { status: 400 }
        )
      }

      // Check if this transition requires Governor enforcement
      const actionKind = STATE_TO_ACTION[state as string]
      if (actionKind) {
        const governorResult = await enforceGovernor({
          actionKind,
          workOrderId: id,
          actor,
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
        state,
        actor
      )

      if (!result) {
        return NextResponse.json(
          { error: 'Failed to update work order' },
          { status: 500 }
        )
      }

      // If there are other updates beyond state, apply them separately
      if (title !== undefined || goalMd !== undefined || priority !== undefined || owner !== undefined || blockedReason !== undefined) {
        const updated = await repos.workOrders.update(id, {
          title,
          goalMd,
          priority,
          owner,
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
      state,
      priority,
      owner,
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
    console.error('[api/work-orders/:id] PATCH error:', error)
    return NextResponse.json(
      { error: 'Failed to update work order' },
      { status: 500 }
    )
  }
}
