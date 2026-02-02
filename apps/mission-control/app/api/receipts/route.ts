import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'
import type { CreateReceiptInput } from '@/lib/repo'

const VALID_RECEIPT_KINDS = ['playbook_step', 'cron_run', 'agent_run', 'manual'] as const

/**
 * GET /api/receipts
 *
 * List receipts with optional filters
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams

  const filters: {
    workOrderId?: string
    operationId?: string
    kind?: string
    running?: boolean
  } = {}

  const workOrderId = searchParams.get('workOrderId')
  if (workOrderId) filters.workOrderId = workOrderId

  const operationId = searchParams.get('operationId')
  if (operationId) filters.operationId = operationId

  const kind = searchParams.get('kind')
  if (kind) filters.kind = kind

  const running = searchParams.get('running')
  if (running !== null) filters.running = running === 'true'

  try {
    const repos = getRepos()
    const data = await repos.receipts.list(filters)
    return NextResponse.json({ data })
  } catch (error) {
    console.error('[api/receipts] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch receipts' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/receipts
 *
 * Create a new receipt (start a command execution)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { workOrderId, operationId, kind, commandName, commandArgs } = body

    // Validate required fields
    if (!workOrderId || !kind || !commandName) {
      return NextResponse.json(
        { error: 'Missing required fields: workOrderId, kind, commandName' },
        { status: 400 }
      )
    }

    // Validate kind
    if (!VALID_RECEIPT_KINDS.includes(kind)) {
      return NextResponse.json(
        { error: `Invalid kind. Must be one of: ${VALID_RECEIPT_KINDS.join(', ')}` },
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

    // Verify operation exists if provided
    if (operationId) {
      const operation = await repos.operations.getById(operationId)
      if (!operation) {
        return NextResponse.json(
          { error: 'Operation not found' },
          { status: 404 }
        )
      }
    }

    const input: CreateReceiptInput = {
      workOrderId,
      operationId: operationId || null,
      kind,
      commandName,
      commandArgs: commandArgs || {},
    }

    const data = await repos.receipts.create(input)

    // Write activity record
    await repos.activities.create({
      type: 'receipt.started',
      actor: 'system',
      entityType: 'receipt',
      entityId: data.id,
      summary: `Started: ${commandName}`,
      payloadJson: {
        workOrderId,
        operationId,
        kind,
        commandName,
      },
    })

    return NextResponse.json({ data }, { status: 201 })
  } catch (error) {
    console.error('[api/receipts] POST error:', error)
    return NextResponse.json(
      { error: 'Failed to create receipt' },
      { status: 500 }
    )
  }
}
