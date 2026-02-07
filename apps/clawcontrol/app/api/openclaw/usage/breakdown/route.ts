import { NextRequest, NextResponse } from 'next/server'
import { getUsageBreakdown, getUsageBreakdownBoth } from '@/lib/openclaw/usage-query'
import { withRouteTiming } from '@/lib/perf/route-timing'

const getUsageBreakdownRoute = async (request: NextRequest) => {
  const { searchParams } = new URL(request.url)
  const groupBy = searchParams.get('groupBy') || 'model'

  if (groupBy !== 'model' && groupBy !== 'agent' && groupBy !== 'both') {
    return NextResponse.json({ error: 'Invalid groupBy' }, { status: 400 })
  }

  const result = groupBy === 'both'
    ? await getUsageBreakdownBoth({
        from: searchParams.get('from'),
        to: searchParams.get('to'),
      })
    : await getUsageBreakdown({
        groupBy: groupBy as 'model' | 'agent',
        from: searchParams.get('from'),
        to: searchParams.get('to'),
      })

  return NextResponse.json({ data: result })
}

export const GET = withRouteTiming('api.openclaw.usage.breakdown.get', getUsageBreakdownRoute)
