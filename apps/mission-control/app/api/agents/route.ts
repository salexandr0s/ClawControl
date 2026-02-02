import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'
import type { AgentFilters } from '@/lib/repo'

/**
 * GET /api/agents
 *
 * List agents with optional filters
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams

  const filters: AgentFilters = {}

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

  try {
    const repos = getRepos()
    const data = await repos.agents.list(filters)

    return NextResponse.json({ data })
  } catch (error) {
    console.error('[api/agents] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch agents' },
      { status: 500 }
    )
  }
}
