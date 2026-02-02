import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'
import { getRequestActor } from '@/lib/request-actor'
import {
  validateOperationTransition,
  getValidOperationTransitions,
  type OperationStatus,
} from '@savorg/core'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * GET /api/operations/:id
 *
 * Get a single operation
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  const { id } = await context.params

  try {
    const repos = getRepos()
    const data = await repos.operations.getById(id)

    if (!data) {
      return NextResponse.json(
        { error: 'Operation not found' },
        { status: 404 }
      )
    }

    // Include allowed status transitions
    const allowedTransitions = getValidOperationTransitions(data.status as OperationStatus)

    return NextResponse.json({ data, allowedTransitions })
  } catch (error) {
    console.error('[api/operations/:id] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch operation' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/operations/:id
 *
 * Update an operation with status transition validation
 */
export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  const { id } = await context.params

  try {
    const body = await request.json()
    const { status, notes, blockedReason } = body

    const repos = getRepos()
    const { actor } = getRequestActor(request)

    // Always fetch current for comparison
    const current = await repos.operations.getById(id)
    if (!current) {
      return NextResponse.json(
        { error: 'Operation not found' },
        { status: 404 }
      )
    }

    // If status is being changed to a different value, validate the transition
    const statusActuallyChanging = status && status !== current.status
    if (statusActuallyChanging) {
      const validation = validateOperationTransition(
        current.status as OperationStatus,
        status as OperationStatus
      )

      if (!validation.valid) {
        return NextResponse.json(
          { error: validation.error, code: 'INVALID_TRANSITION' },
          { status: 400 }
        )
      }
    }

    // If status is actually changing, use atomic transaction
    if (statusActuallyChanging) {
      const result = await repos.operations.updateStatusWithActivity(
        id,
        status,
        actor
      )

      if (!result) {
        return NextResponse.json(
          { error: 'Failed to update operation' },
          { status: 500 }
        )
      }

      // If there are other updates beyond status, apply them separately
      if (notes !== undefined || blockedReason !== undefined) {
        const updated = await repos.operations.update(id, {
          notes,
          blockedReason,
        })
        return NextResponse.json({ data: updated })
      }

      return NextResponse.json({ data: result.operation })
    }

    // No status change - regular update without activity
    const data = await repos.operations.update(id, {
      status,
      notes,
      blockedReason,
    })

    if (!data) {
      return NextResponse.json(
        { error: 'Failed to update operation' },
        { status: 500 }
      )
    }

    return NextResponse.json({ data })
  } catch (error) {
    console.error('[api/operations/:id] PATCH error:', error)
    return NextResponse.json(
      { error: 'Failed to update operation' },
      { status: 500 }
    )
  }
}
