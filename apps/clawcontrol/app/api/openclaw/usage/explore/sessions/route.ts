import { NextRequest, NextResponse } from 'next/server'
import { withRouteTiming } from '@/lib/perf/route-timing'
import {
  getUsageExploreSessions,
  parseUsageExploreFiltersFromSearchParams,
} from '@/lib/openclaw/usage-explore-query'

const getUsageExploreSessionsRoute = async (request: NextRequest) => {
  const { searchParams } = new URL(request.url)
  const filters = parseUsageExploreFiltersFromSearchParams(searchParams)
  const result = await getUsageExploreSessions(filters)
  return NextResponse.json({ data: result })
}

export const GET = withRouteTiming('api.openclaw.usage.explore.sessions.get', getUsageExploreSessionsRoute)
