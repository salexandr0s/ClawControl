import { NextRequest, NextResponse } from 'next/server'
import { getCronHealth } from '@/lib/openclaw/cron-health'
import { withRouteTiming } from '@/lib/perf/route-timing'

const getCronHealthRoute = async (request: NextRequest) => {
  const { searchParams } = new URL(request.url)
  const daysRaw = searchParams.get('days')
  const days = daysRaw ? Number(daysRaw) : 7

  const data = await getCronHealth(days)
  return NextResponse.json({ data })
}

export const GET = withRouteTiming('api.openclaw.cron.health.get', getCronHealthRoute)
