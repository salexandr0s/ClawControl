import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * PATCH /api/receipts/:id/append
 *
 * Append stdout/stderr chunk to a running receipt
 */
export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  const { id } = await context.params

  try {
    const body = await request.json()
    const { stream, chunk } = body

    // Validate required fields
    if (!stream || chunk === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: stream, chunk' },
        { status: 400 }
      )
    }

    // Validate stream type
    if (stream !== 'stdout' && stream !== 'stderr') {
      return NextResponse.json(
        { error: 'Invalid stream. Must be "stdout" or "stderr"' },
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

    // Check if receipt is still running
    if (existing.endedAt !== null) {
      return NextResponse.json(
        { error: 'Receipt already finalized' },
        { status: 400 }
      )
    }

    const data = await repos.receipts.append(id, { stream, chunk })

    if (!data) {
      return NextResponse.json(
        { error: 'Failed to append to receipt' },
        { status: 500 }
      )
    }

    return NextResponse.json({ data })
  } catch (error) {
    console.error('[api/receipts/:id/append] PATCH error:', error)
    return NextResponse.json(
      { error: 'Failed to append to receipt' },
      { status: 500 }
    )
  }
}
