import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { invalidateAsyncCacheByPrefix } from '@/lib/perf/async-cache'
import { withIngestionLease } from '@/lib/openclaw/ingestion-lease'
import { syncUsageTelemetry } from '@/lib/openclaw/usage-sync'

const LEASE_NAME = 'usage-sync'

export async function POST(request: NextRequest) {
  let body: {
    maxMs?: number
    maxFiles?: number
    force?: boolean
  } = {}

  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const leased = await withIngestionLease(LEASE_NAME, async () => {
    const startedAt = Date.now()

    if (body.force) {
      await prisma.$transaction([
        prisma.sessionToolUsage.deleteMany({}),
        prisma.sessionUsageAggregate.deleteMany({}),
        prisma.usageIngestionCursor.deleteMany({}),
      ])
    }

    const syncStats = await syncUsageTelemetry({
      maxMs: body.maxMs,
      maxFiles: body.maxFiles,
    })

    // Ensure summary/breakdown endpoints reflect fresh DB state immediately after a sync.
    invalidateAsyncCacheByPrefix('usage.')

    return {
      ok: true,
      lockAcquired: true,
      ...syncStats,
      durationMs: Date.now() - startedAt,
    }
  })

  if (!leased.lockAcquired) {
    return NextResponse.json({
      ok: true,
      lockAcquired: false,
      filesScanned: 0,
      filesUpdated: 0,
      sessionsUpdated: 0,
      toolsUpserted: 0,
      cursorResets: 0,
      durationMs: 0,
    })
  }

  return NextResponse.json(leased.value)
}
