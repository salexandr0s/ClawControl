import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * PATCH /api/receipts/:id/finalize
 *
 * Finalize a receipt (mark command execution as complete)
 */
export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  const { id } = await context.params

  try {
    const body = await request.json()
    const { exitCode, durationMs, parsedJson } = body

    // Validate required fields
    if (exitCode === undefined || durationMs === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: exitCode, durationMs' },
        { status: 400 }
      )
    }

    const repos = getRepos()

    // Check if receipt exists
    const existing = await repos.receipts.getById(id)
    if (!existing) {
      return NextResponse.json(
        { error: 'Receipt not found' },
        { status: 404 }
      )
    }

    // Check if receipt is still running (idempotency)
    if (existing.endedAt !== null) {
      // Already finalized - return existing
      return NextResponse.json({ data: existing })
    }

    const data = await repos.receipts.finalize(id, {
      exitCode,
      durationMs,
      parsedJson,
    })

    if (!data) {
      return NextResponse.json(
        { error: 'Failed to finalize receipt' },
        { status: 500 }
      )
    }

    // Write activity record
    const status = exitCode === 0 ? 'succeeded' : 'failed'
    await repos.activities.create({
      type: `receipt.${status}`,
      actor: 'system',
      entityType: 'receipt',
      entityId: id,
      summary: `${existing.commandName} ${status} (exit ${exitCode}, ${durationMs}ms)`,
      payloadJson: {
        workOrderId: existing.workOrderId,
        operationId: existing.operationId,
        commandName: existing.commandName,
        exitCode,
        durationMs,
      },
    })

    return NextResponse.json({ data })
  } catch (error) {
    console.error('[api/receipts/:id/finalize] PATCH error:', error)
    return NextResponse.json(
      { error: 'Failed to finalize receipt' },
      { status: 500 }
    )
  }
}
