import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'
import type { ActivityFilters, PaginationOptions } from '@/lib/repo'

/**
 * GET /api/activities
 *
 * List activities with optional filters and pagination
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams

  const filters: ActivityFilters = {}
  const pagination: PaginationOptions = {}

  // Entity type filter
  const entityType = searchParams.get('entityType')
  if (entityType) {
    filters.entityType = entityType
  }

  // Entity ID filter
  const entityId = searchParams.get('entityId')
  if (entityId) {
    filters.entityId = entityId
  }

  // Activity type filter
  const type = searchParams.get('type')
  if (type) {
    filters.type = type
  }

  // Pagination
  const limitStr = searchParams.get('limit')
  if (limitStr) {
    pagination.limit = parseInt(limitStr, 10)
  }

  const offsetStr = searchParams.get('offset')
  if (offsetStr) {
    pagination.offset = parseInt(offsetStr, 10)
  }

  try {
    const repos = getRepos()
    const data = await repos.activities.list(filters, pagination)

    return NextResponse.json({
      data,
      meta: {
        hasMore: data.length === (pagination.limit || 50),
      },
    })
  } catch (error) {
    console.error('[api/activities] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch activities' },
      { status: 500 }
    )
  }
}
