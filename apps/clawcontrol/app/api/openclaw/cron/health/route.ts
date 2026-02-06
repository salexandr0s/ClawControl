import { NextRequest, NextResponse } from 'next/server'
import { getCronHealth } from '@/lib/openclaw/cron-health'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const daysRaw = searchParams.get('days')
  const days = daysRaw ? Number(daysRaw) : 7

  const data = await getCronHealth(days)
  return NextResponse.json({ data })
}
