import { NextRequest, NextResponse } from 'next/server'
import { withIngestionLease } from '@/lib/openclaw/ingestion-lease'
import { getErrorSummary, syncErrorLog } from '@/lib/openclaw/error-sync'

const LEASE_NAME = 'errors-ingest'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const daysRaw = searchParams.get('days')
  const days = daysRaw ? Number(daysRaw) : 14

  let ingestion:
    | {
      lockAcquired: boolean
      stats?: Awaited<ReturnType<typeof syncErrorLog>>
    }
    = { lockAcquired: false }

  const leased = await withIngestionLease(LEASE_NAME, async () => {
    const stats = await syncErrorLog()
    return stats
  })

  if (leased.lockAcquired) {
    ingestion = { lockAcquired: true, stats: leased.value }
  }

  const summary = await getErrorSummary(days)

  return NextResponse.json({
    data: summary,
    ingestion,
  })
}
