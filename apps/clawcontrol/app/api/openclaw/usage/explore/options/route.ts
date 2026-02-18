import { NextRequest, NextResponse } from 'next/server'
import { withRouteTiming } from '@/lib/perf/route-timing'
import {
  getUsageExploreOptions,
  parseUsageExploreFiltersFromSearchParams,
} from '@/lib/openclaw/usage-explore-query'

const getUsageExploreOptionsRoute = async (request: NextRequest) => {
  const { searchParams } = new URL(request.url)
  const filters = parseUsageExploreFiltersFromSearchParams(searchParams)
  const result = await getUsageExploreOptions(filters)
  return NextResponse.json({ data: result })
}

export const GET = withRouteTiming('api.openclaw.usage.explore.options.get', getUsageExploreOptionsRoute)
