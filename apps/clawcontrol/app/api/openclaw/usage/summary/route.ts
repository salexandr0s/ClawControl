import { NextRequest, NextResponse } from 'next/server'
import { getUsageSummary, type RangeType } from '@/lib/openclaw/usage-query'
import { withRouteTiming } from '@/lib/perf/route-timing'

const ALLOWED_RANGE: RangeType[] = ['daily', 'weekly', 'monthly']

const getUsageSummaryRoute = async (request: NextRequest) => {
  const { searchParams } = new URL(request.url)
  const range = (searchParams.get('range') || 'daily') as RangeType

  if (!ALLOWED_RANGE.includes(range)) {
    return NextResponse.json({ error: 'Invalid range' }, { status: 400 })
  }

  const result = await getUsageSummary({
    range,
    from: searchParams.get('from'),
    to: searchParams.get('to'),
    agentId: searchParams.get('agentId'),
  })

  return NextResponse.json({ data: result })
}

export const GET = withRouteTiming('api.openclaw.usage.summary.get', getUsageSummaryRoute)
