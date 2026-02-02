import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * GET /api/receipts/:id
 *
 * Get a single receipt
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  const { id } = await context.params

  try {
    const repos = getRepos()
    const data = await repos.receipts.getById(id)

    if (!data) {
      return NextResponse.json(
        { error: 'Receipt not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ data })
  } catch (error) {
    console.error('[api/receipts/:id] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch receipt' },
      { status: 500 }
    )
  }
}
