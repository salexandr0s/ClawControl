import { NextRequest, NextResponse } from 'next/server'
import { withIngestionLease } from '@/lib/openclaw/ingestion-lease'
import { getErrorSummary, syncErrorLog } from '@/lib/openclaw/error-sync'
import {
  ERROR_ANALYTICS_SCHEMA_CODE,
  ERROR_ANALYTICS_SCHEMA_WARNING,
  isErrorAnalyticsSchemaDrift,
} from '../_schema-drift'

const LEASE_NAME = 'errors-ingest'

function emptySummary(days: number) {
  const safeDays = Number.isFinite(days) ? Math.max(1, Math.min(90, Math.floor(days))) : 14
  const toDay = new Date()
  toDay.setUTCHours(0, 0, 0, 0)

  const from = new Date(toDay)
  from.setUTCDate(from.getUTCDate() - safeDays + 1)

  const trend = Array.from({ length: safeDays }, (_, index) => {
    const day = new Date(from)
    day.setUTCDate(day.getUTCDate() + index)
    return { day: day.toISOString(), count: '0' }
  })

  return {
    generatedAt: new Date().toISOString(),
    from: from.toISOString(),
    to: new Date(toDay.getTime() + 86_400_000 - 1).toISOString(),
    trend,
    totals: {
      totalErrors: '0',
      uniqueSignatures: 0,
      windowUniqueSignatures: 0,
    },
    topSignatures: [],
    spike: {
      detected: false,
      yesterdayCount: 0,
      baseline: 0,
    },
  }
}

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

  try {
    const leased = await withIngestionLease(LEASE_NAME, async () => {
      const stats = await syncErrorLog()
      return stats
    })

    if (leased.lockAcquired) {
      ingestion = { lockAcquired: true, stats: leased.value }
    }
  } catch (error) {
    if (isErrorAnalyticsSchemaDrift(error)) {
      return NextResponse.json({
        data: emptySummary(days),
        ingestion,
        warning: ERROR_ANALYTICS_SCHEMA_WARNING,
        code: ERROR_ANALYTICS_SCHEMA_CODE,
      })
    }

    throw error
  }

  try {
    const summary = await getErrorSummary(days)

    return NextResponse.json({
      data: summary,
      ingestion,
    })
  } catch (error) {
    if (isErrorAnalyticsSchemaDrift(error)) {
      return NextResponse.json({
        data: emptySummary(days),
        ingestion,
        warning: ERROR_ANALYTICS_SCHEMA_WARNING,
        code: ERROR_ANALYTICS_SCHEMA_CODE,
      })
    }

    throw error
  }
}
