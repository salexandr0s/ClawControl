import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'
import type { WorkOrderFilters } from '@/lib/repo'

/**
 * GET /api/work-orders
 *
 * List work orders with optional filters
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams

  const filters: WorkOrderFilters = {}

  // State filter (can be comma-separated)
  const state = searchParams.get('state')
  if (state) {
    filters.state = state.includes(',') ? state.split(',') : state
  }

  // Priority filter (can be comma-separated)
  const priority = searchParams.get('priority')
  if (priority) {
    filters.priority = priority.includes(',') ? priority.split(',') : priority
  }

  // Owner filter
  const owner = searchParams.get('owner')
  if (owner) {
    filters.owner = owner
  }

  // Limit (for cursor pagination)
  const limitStr = searchParams.get('limit')
  const limit = limitStr ? parseInt(limitStr, 10) : 50

  try {
    const repos = getRepos()
    let data = await repos.workOrders.listWithOps(filters)

    // Apply limit
    const hasMore = data.length > limit
    data = data.slice(0, limit)

    return NextResponse.json({
      data,
      meta: {
        hasMore,
        total: data.length,
      },
    })
  } catch (error) {
    console.error('[api/work-orders] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch work orders' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/work-orders
 *
 * Create a new work order
 *
 * Security: All work order creation is logged to the activity stream
 * for audit trail purposes.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const { title, goalMd, priority = 'P2', owner = 'user' } = body

    if (!title || !goalMd) {
      return NextResponse.json(
        { error: 'Missing required fields: title, goalMd' },
        { status: 400 }
      )
    }

    const repos = getRepos()
    const data = await repos.workOrders.create({
      title,
      goalMd,
      priority,
      owner,
    })

    // Log work order creation for audit trail (P0 Security Fix)
    await repos.activities.create({
      type: 'work_order.created',
      actor: owner === 'savorgceo' ? 'agent:savorgCEO' : 'user',
      entityType: 'work_order',
      entityId: data.id,
      summary: `Work order ${data.code} created: ${title}`,
      payloadJson: {
        code: data.code,
        title,
        priority,
        owner,
        state: data.state,
      },
    })

    return NextResponse.json({ data }, { status: 201 })
  } catch (error) {
    console.error('[api/work-orders] POST error:', error)
    return NextResponse.json(
      { error: 'Failed to create work order' },
      { status: 500 }
    )
  }
}
