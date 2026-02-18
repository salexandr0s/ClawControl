import { NextRequest, NextResponse } from 'next/server'
import { withRouteTiming } from '@/lib/perf/route-timing'
import {
  getUsageExploreBreakdown,
  parseUsageExploreFiltersFromSearchParams,
  type UsageExploreBreakdownKey,
} from '@/lib/openclaw/usage-explore-query'

const VALID_GROUP_BY: UsageExploreBreakdownKey[] = ['agent', 'model', 'provider', 'source', 'sessionClass', 'tool']

const getUsageExploreBreakdownRoute = async (request: NextRequest) => {
  const { searchParams } = new URL(request.url)
  const groupBy = (searchParams.get('groupBy') ?? 'model') as UsageExploreBreakdownKey

  if (!VALID_GROUP_BY.includes(groupBy)) {
    return NextResponse.json({ error: 'Invalid groupBy' }, { status: 400 })
  }

  const filters = parseUsageExploreFiltersFromSearchParams(searchParams)
  const result = await getUsageExploreBreakdown({
    ...filters,
    groupBy,
  })

  return NextResponse.json({ data: result })
}

export const GET = withRouteTiming('api.openclaw.usage.explore.breakdown.get', getUsageExploreBreakdownRoute)
