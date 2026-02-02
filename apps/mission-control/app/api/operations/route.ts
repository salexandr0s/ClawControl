import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'
import type { OperationFilters, CreateOperationInput } from '@/lib/repo'

/**
 * GET /api/operations
 *
 * List operations with optional filters
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams

  const filters: OperationFilters = {}

  // Work order filter
  const workOrderId = searchParams.get('workOrderId')
  if (workOrderId) {
    filters.workOrderId = workOrderId
  }

  // Station filter (can be comma-separated)
  const station = searchParams.get('station')
  if (station) {
    filters.station = station.includes(',') ? station.split(',') : station
  }

  // Status filter (can be comma-separated)
  const status = searchParams.get('status')
  if (status) {
    filters.status = status.includes(',') ? status.split(',') : status
  }

  // Limit
  const limitStr = searchParams.get('limit')
  const limit = limitStr ? parseInt(limitStr, 10) : 100

  try {
    const repos = getRepos()
    let data = await repos.operations.list(filters)

    // Apply limit
    data = data.slice(0, limit)

    return NextResponse.json({ data })
  } catch (error) {
    console.error('[api/operations] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch operations' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/operations
 *
 * Create a new operation
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { workOrderId, station, title, notes, dependsOnOperationIds, wipClass } = body

    // Validate required fields
    if (!workOrderId || !station || !title) {
      return NextResponse.json(
        { error: 'Missing required fields: workOrderId, station, title' },
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

    const input: CreateOperationInput = {
      workOrderId,
      station,
      title,
      notes,
      dependsOnOperationIds,
      wipClass,
    }

    const data = await repos.operations.create(input)

    // Write activity record
    await repos.activities.create({
      type: 'operation.created',
      actor: 'system',
      entityType: 'operation',
      entityId: data.id,
      summary: `Operation "${title}" created for ${workOrder.code}`,
      payloadJson: {
        workOrderId,
        station,
        title,
      },
    })

    return NextResponse.json({ data }, { status: 201 })
  } catch (error) {
    console.error('[api/operations] POST error:', error)
    return NextResponse.json(
      { error: 'Failed to create operation' },
      { status: 500 }
    )
  }
}
