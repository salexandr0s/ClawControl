import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'
import type { ApprovalFilters, CreateApprovalInput } from '@/lib/repo'

/**
 * GET /api/approvals
 *
 * List approvals with optional filters
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams

  const filters: ApprovalFilters = {}

  // Status filter (can be comma-separated)
  const status = searchParams.get('status')
  if (status) {
    filters.status = status.includes(',') ? status.split(',') : status
  }

  // Type filter (can be comma-separated)
  const type = searchParams.get('type')
  if (type) {
    filters.type = type.includes(',') ? type.split(',') : type
  }

  // Work order filter
  const workOrderId = searchParams.get('workOrderId')
  if (workOrderId) {
    filters.workOrderId = workOrderId
  }

  // Limit
  const limitStr = searchParams.get('limit')
  const limit = limitStr ? parseInt(limitStr, 10) : 50

  try {
    const repos = getRepos()
    let data = await repos.approvals.list(filters)

    // Apply limit
    data = data.slice(0, limit)

    return NextResponse.json({ data })
  } catch (error) {
    console.error('[api/approvals] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch approvals' },
      { status: 500 }
    )
  }
}

const VALID_APPROVAL_TYPES = ['ship_gate', 'risky_action', 'scope_change', 'cron_change', 'external_side_effect']

/**
 * POST /api/approvals
 *
 * Create a new approval request
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { workOrderId, operationId, type, questionMd } = body

    // Validate required fields
    if (!workOrderId || !type || !questionMd) {
      return NextResponse.json(
        { error: 'Missing required fields: workOrderId, type, questionMd' },
        { status: 400 }
      )
    }

    // Validate type
    if (!VALID_APPROVAL_TYPES.includes(type)) {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: ${VALID_APPROVAL_TYPES.join(', ')}` },
        { status: 400 }
      )
    }

    const repos = getRepos()

    // Verify work order exists
    const workOrder = await repos.workOrders.getById(workOrderId)
    if (!workOrder) {
      return NextResponse.json(
        { error: 'Work order not found' },
        { status: 404 }
      )
    }

    // Check for existing pending approval of same type for this work order/operation
    // This ensures idempotency - only one pending approval per (workOrderId, operationId, type)
    const existingApprovals = await repos.approvals.list({
      workOrderId,
      type,
      status: 'pending',
    })
    const existingPending = existingApprovals.find(
      (a) => a.operationId === (operationId || null)
    )
    if (existingPending) {
      // Return the existing approval instead of creating a duplicate
      return NextResponse.json({ data: existingPending }, { status: 200 })
    }

    const input: CreateApprovalInput = {
      workOrderId,
      operationId: operationId || null,
      type: type as CreateApprovalInput['type'],
      questionMd,
    }

    const data = await repos.approvals.create(input)

    // Write activity record
    await repos.activities.create({
      type: 'approval.requested',
      actor: 'system',
      entityType: 'approval',
      entityId: data.id,
      summary: `Approval requested: ${type.replace(/_/g, ' ')}`,
      payloadJson: {
        workOrderId,
        operationId,
        approvalType: type,
      },
    })

    // Also write activity for the work order
    await repos.activities.create({
      type: 'work_order.approval_requested',
      actor: 'system',
      entityType: 'work_order',
      entityId: workOrderId,
      summary: `Approval requested for ${type.replace(/_/g, ' ')}`,
      payloadJson: {
        approvalId: data.id,
        approvalType: type,
      },
    })

    return NextResponse.json({ data }, { status: 201 })
  } catch (error) {
    console.error('[api/approvals] POST error:', error)
    return NextResponse.json(
      { error: 'Failed to create approval' },
      { status: 500 }
    )
  }
}
