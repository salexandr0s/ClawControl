import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { invalidateAsyncCacheByPrefix } from '@/lib/perf/async-cache'
import { withIngestionLease } from '@/lib/openclaw/ingestion-lease'
import { resolveUsageParityScope } from '@/lib/openclaw/usage-parity-scope'
import { syncUsageTelemetry } from '@/lib/openclaw/usage-sync'

const LEASE_NAME = 'usage-sync'
const USAGE_INDEX_VERSION_KEY = 'usage.index.version'
const USAGE_INDEX_VERSION = '3'

async function resetUsageIndexes(): Promise<void> {
  await prisma.$transaction([
    prisma.sessionToolUsageDailyAggregate.deleteMany({}),
    prisma.sessionUsageHourlyAggregate.deleteMany({}),
    prisma.sessionToolUsage.deleteMany({}),
    prisma.sessionUsageDailyAggregate.deleteMany({}),
    prisma.sessionUsageAggregate.deleteMany({}),
    prisma.usageIngestionCursor.deleteMany({}),
    prisma.setting.upsert({
      where: { key: USAGE_INDEX_VERSION_KEY },
      create: {
        key: USAGE_INDEX_VERSION_KEY,
        value: USAGE_INDEX_VERSION,
      },
      update: {
        value: USAGE_INDEX_VERSION,
      },
    }),
  ])
}

export async function POST(request: NextRequest) {
  let body: {
    maxMs?: number
    maxFiles?: number
    force?: boolean
    mode?: 'parity'
    from?: string
    to?: string
    sessionLimit?: number
  } = {}

  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const leased = await withIngestionLease(LEASE_NAME, async () => {
    const startedAt = Date.now()
    let rebuildTriggered = false

    if (body.force) {
      await resetUsageIndexes()
      rebuildTriggered = true
    } else {
      const versionSetting = await prisma.setting.findUnique({
        where: { key: USAGE_INDEX_VERSION_KEY },
        select: { value: true },
      })

      if (versionSetting?.value !== USAGE_INDEX_VERSION) {
        await resetUsageIndexes()
        rebuildTriggered = true
      }
    }

    const parityScope = body.mode === 'parity'
      ? await resolveUsageParityScope({
        from: body.from,
        to: body.to,
        sessionLimit: body.sessionLimit,
      })
      : null

    const syncStats = await syncUsageTelemetry({
      maxMs: body.maxMs,
      maxFiles: body.maxFiles,
      priorityPaths: parityScope?.priorityPaths,
    })

    // Ensure summary/breakdown endpoints reflect fresh DB state immediately after a sync.
    invalidateAsyncCacheByPrefix('usage.')

    return {
      ok: true,
      lockAcquired: true,
      indexVersion: USAGE_INDEX_VERSION,
      rebuildTriggered,
      rebuildInProgress: syncStats.filesRemaining > 0,
      parity: parityScope
        ? {
          sessionLimit: parityScope.sessionLimit,
          sampledCount: parityScope.sampledCount,
          sessionsInRangeTotal: parityScope.sessionsInRangeTotal,
          missingCoverageCount: parityScope.missingCoverageCount,
        }
        : null,
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
      filesTotal: 0,
      filesRemaining: 0,
      coveragePct: 0,
      indexVersion: USAGE_INDEX_VERSION,
      rebuildTriggered: false,
      rebuildInProgress: false,
      parity: null,
      durationMs: 0,
    })
  }

  return NextResponse.json(leased.value)
}
