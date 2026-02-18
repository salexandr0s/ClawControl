import { NextRequest, NextResponse } from 'next/server'
import { withRouteTiming } from '@/lib/perf/route-timing'
import {
  getUsageExploreSummary,
  parseUsageExploreFiltersFromSearchParams,
} from '@/lib/openclaw/usage-explore-query'

const getUsageExploreSummaryRoute = async (request: NextRequest) => {
  const { searchParams } = new URL(request.url)
  const filters = parseUsageExploreFiltersFromSearchParams(searchParams)
  const result = await getUsageExploreSummary(filters)
  return NextResponse.json({ data: result })
}

export const GET = withRouteTiming('api.openclaw.usage.explore.summary.get', getUsageExploreSummaryRoute)
