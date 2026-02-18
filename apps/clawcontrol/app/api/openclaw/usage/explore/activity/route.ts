import { NextRequest, NextResponse } from 'next/server'
import { withRouteTiming } from '@/lib/perf/route-timing'
import {
  getUsageExploreActivity,
  parseUsageExploreFiltersFromSearchParams,
} from '@/lib/openclaw/usage-explore-query'

const getUsageExploreActivityRoute = async (request: NextRequest) => {
  const { searchParams } = new URL(request.url)
  const filters = parseUsageExploreFiltersFromSearchParams(searchParams)
  const result = await getUsageExploreActivity(filters)
  return NextResponse.json({ data: result })
}

export const GET = withRouteTiming('api.openclaw.usage.explore.activity.get', getUsageExploreActivityRoute)
