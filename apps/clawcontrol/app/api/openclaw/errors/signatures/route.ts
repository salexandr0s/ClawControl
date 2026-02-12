import { NextRequest, NextResponse } from 'next/server'
import { asAuthErrorResponse, verifyOperatorRequest } from '@/lib/auth/operator-auth'
import { withIngestionLease } from '@/lib/openclaw/ingestion-lease'
import { listErrorSignatures, syncErrorLog } from '@/lib/openclaw/error-sync'
import { autoGenerateErrorInsights } from '@/lib/openclaw/error-insights'
import {
  ERROR_ANALYTICS_SCHEMA_CODE,
  ERROR_ANALYTICS_SCHEMA_WARNING,
  isErrorAnalyticsSchemaDrift,
} from '../_schema-drift'

const LEASE_NAME = 'errors-ingest'

function emptySignatures(days: number, limit: number, includeRaw: boolean) {
  const safeDays = Number.isFinite(days) ? Math.max(1, Math.min(90, Math.floor(days))) : 14
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 20

  const toDay = new Date()
  toDay.setUTCHours(0, 0, 0, 0)

  const from = new Date(toDay)
  from.setUTCDate(from.getUTCDate() - safeDays + 1)

  return {
    generatedAt: new Date().toISOString(),
    from: from.toISOString(),
    to: new Date(toDay.getTime() + 86_400_000 - 1).toISOString(),
    days: safeDays,
    signatures: [],
    meta: {
      limit: safeLimit,
      includeRaw,
      windowUniqueSignatures: 0,
    },
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const daysRaw = searchParams.get('days')
  const limitRaw = searchParams.get('limit')
  const includeRaw = searchParams.get('includeRaw') === 'true'

  if (includeRaw) {
    const auth = verifyOperatorRequest(request)
    if (!auth.ok) {
      return NextResponse.json(asAuthErrorResponse(auth), { status: auth.status })
    }
  }

  const days = daysRaw ? Number(daysRaw) : 14
  const limit = limitRaw ? Number(limitRaw) : 20

  let ingestion:
    | {
      lockAcquired: boolean
      stats?: Awaited<ReturnType<typeof syncErrorLog>>
    }
    = { lockAcquired: false }

  let list: Awaited<ReturnType<typeof listErrorSignatures>>
  try {
    const leased = await withIngestionLease(LEASE_NAME, async () => {
      const stats = await syncErrorLog()
      return stats
    })

    if (leased.lockAcquired) {
      ingestion = { lockAcquired: true, stats: leased.value }
    }

    list = await listErrorSignatures({
      days,
      limit,
      includeRaw,
    })
  } catch (error) {
    if (isErrorAnalyticsSchemaDrift(error)) {
      return NextResponse.json({
        data: emptySignatures(days, limit, includeRaw),
        ingestion,
        warning: ERROR_ANALYTICS_SCHEMA_WARNING,
        code: ERROR_ANALYTICS_SCHEMA_CODE,
      })
    }
    throw error
  }

  let warning: string | undefined
  let code: string | undefined
  let insightSnapshots: Awaited<ReturnType<typeof autoGenerateErrorInsights>> = new Map()
  try {
    insightSnapshots = await autoGenerateErrorInsights(list.signatures, { maxBatch: 3 })
  } catch (error) {
    if (isErrorAnalyticsSchemaDrift(error)) {
      warning = ERROR_ANALYTICS_SCHEMA_WARNING
      code = ERROR_ANALYTICS_SCHEMA_CODE
    } else {
      throw error
    }
  }

  const signatures = list.signatures.map((signature) => ({
    ...signature,
    insight: insightSnapshots.get(signature.signatureHash) ?? signature.insight,
  }))

  const response = {
    data: {
      ...list,
      signatures,
    },
    ingestion,
    ...(warning ? { warning, code } : {}),
  }

  return NextResponse.json(response)
}
