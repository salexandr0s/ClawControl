import 'server-only'

import { promises as fsp } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { parseGatewayErrorLog, type ParsedErrorEvent } from './error-parser'

export interface ErrorSyncStats {
  processedEvents: number
  signaturesUpdated: number
  daysUpdated: number
  cursorReset: boolean
  durationMs: number
}

export interface ErrorSummaryResult {
  generatedAt: string
  from: string
  to: string
  trend: Array<{ day: string; count: string }>
  totals: {
    totalErrors: string
    uniqueSignatures: number
  }
  topSignatures: Array<{
    signatureHash: string
    signatureText: string
    count: string
    firstSeen: string
    lastSeen: string
    sample: string
  }>
  spike: {
    detected: boolean
    yesterdayCount: number
    baseline: number
  }
}

function getGatewayErrorLogPath(): string {
  return join(process.env.OPENCLAW_HOME || join(homedir(), '.openclaw'), 'logs', 'gateway.err.log')
}

function toBigInt(value: number | bigint): bigint {
  if (typeof value === 'bigint') return value
  if (!Number.isFinite(value)) return 0n
  return BigInt(Math.trunc(value))
}

function deriveFingerprint(stat: {
  dev: number | bigint
  ino: number | bigint
  size: number | bigint
  mtimeMs: number
}) {
  return {
    deviceId: toBigInt(stat.dev),
    inode: toBigInt(stat.ino),
    fileSizeBytes: toBigInt(stat.size),
    fileMtimeMs: toBigInt(stat.mtimeMs),
  }
}

function shouldResetCursor(
  cursor: {
    deviceId: bigint
    inode: bigint
    offsetBytes: bigint
    fileMtimeMs: bigint
    fileSizeBytes: bigint
  },
  next: {
    deviceId: bigint
    inode: bigint
    fileSizeBytes: bigint
    fileMtimeMs: bigint
  }
): boolean {
  if (cursor.deviceId !== next.deviceId) return true
  if (cursor.inode !== next.inode) return true
  if (next.fileSizeBytes < cursor.offsetBytes) return true
  if (next.fileMtimeMs < cursor.fileMtimeMs && next.fileSizeBytes !== cursor.fileSizeBytes) return true
  return false
}

function dayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

export async function syncErrorLog(): Promise<ErrorSyncStats> {
  const startedAt = Date.now()
  const sourcePath = getGatewayErrorLogPath()

  let stat: Awaited<ReturnType<typeof fsp.stat>>
  try {
    stat = await fsp.stat(sourcePath, { bigint: true })
  } catch {
    return {
      processedEvents: 0,
      signaturesUpdated: 0,
      daysUpdated: 0,
      cursorReset: false,
      durationMs: Date.now() - startedAt,
    }
  }

  const fingerprint = deriveFingerprint({
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: Number(stat.mtimeMs),
  })

  const cursor = await prisma.errorIngestionCursor.findUnique({
    where: { sourcePath },
  })

  const cursorReset = cursor
    ? shouldResetCursor(cursor, fingerprint)
    : false

  const offsetBytes = cursorReset ? 0n : (cursor?.offsetBytes ?? 0n)

  if (fingerprint.fileSizeBytes <= offsetBytes) {
    await prisma.errorIngestionCursor.upsert({
      where: { sourcePath },
      create: {
        sourcePath,
        deviceId: fingerprint.deviceId,
        inode: fingerprint.inode,
        offsetBytes: fingerprint.fileSizeBytes,
        fileMtimeMs: fingerprint.fileMtimeMs,
        fileSizeBytes: fingerprint.fileSizeBytes,
      },
      update: {
        deviceId: fingerprint.deviceId,
        inode: fingerprint.inode,
        offsetBytes: fingerprint.fileSizeBytes,
        fileMtimeMs: fingerprint.fileMtimeMs,
        fileSizeBytes: fingerprint.fileSizeBytes,
      },
    })

    return {
      processedEvents: 0,
      signaturesUpdated: 0,
      daysUpdated: 0,
      cursorReset,
      durationMs: Date.now() - startedAt,
    }
  }

  const signatureDeltas = new Map<string, {
    signatureText: string
    sample: string
    count: bigint
    firstSeen: Date
    lastSeen: Date
  }>()

  const dayDeltas = new Map<string, bigint>()
  let processedEvents = 0

  await parseGatewayErrorLog(sourcePath, offsetBytes, (event: ParsedErrorEvent) => {
    processedEvents++

    const prevSig = signatureDeltas.get(event.signatureHash)
    if (!prevSig) {
      signatureDeltas.set(event.signatureHash, {
        signatureText: event.signatureText,
        sample: event.sample,
        count: 1n,
        firstSeen: event.occurredAt,
        lastSeen: event.occurredAt,
      })
    } else {
      prevSig.count += 1n
      prevSig.signatureText = event.signatureText
      prevSig.sample = event.sample || prevSig.sample
      if (event.occurredAt < prevSig.firstSeen) prevSig.firstSeen = event.occurredAt
      if (event.occurredAt > prevSig.lastSeen) prevSig.lastSeen = event.occurredAt
      signatureDeltas.set(event.signatureHash, prevSig)
    }

    const day = dayStart(event.occurredAt).toISOString()
    dayDeltas.set(day, (dayDeltas.get(day) ?? 0n) + 1n)
  })

  let signaturesUpdated = 0
  for (const [signatureHash, delta] of signatureDeltas.entries()) {
    const existing = await prisma.errorSignatureAggregate.findUnique({
      where: { signatureHash },
    })

    if (!existing) {
      await prisma.errorSignatureAggregate.create({
        data: {
          signatureHash,
          signatureText: delta.signatureText,
          count: delta.count,
          firstSeenAt: delta.firstSeen,
          lastSeenAt: delta.lastSeen,
          lastSampleSanitized: delta.sample,
        },
      })
    } else {
      await prisma.errorSignatureAggregate.update({
        where: { signatureHash },
        data: {
          signatureText: delta.signatureText,
          count: existing.count + delta.count,
          firstSeenAt: existing.firstSeenAt < delta.firstSeen ? existing.firstSeenAt : delta.firstSeen,
          lastSeenAt: existing.lastSeenAt > delta.lastSeen ? existing.lastSeenAt : delta.lastSeen,
          lastSampleSanitized: delta.sample || existing.lastSampleSanitized,
        },
      })
    }

    signaturesUpdated++
  }

  let daysUpdated = 0
  for (const [dayIso, count] of dayDeltas.entries()) {
    const day = new Date(dayIso)

    const existing = await prisma.errorDailyAggregate.findUnique({
      where: { day },
    })

    if (!existing) {
      await prisma.errorDailyAggregate.create({
        data: { day, count },
      })
    } else {
      await prisma.errorDailyAggregate.update({
        where: { day },
        data: { count: existing.count + count },
      })
    }

    daysUpdated++
  }

  await prisma.errorIngestionCursor.upsert({
    where: { sourcePath },
    create: {
      sourcePath,
      deviceId: fingerprint.deviceId,
      inode: fingerprint.inode,
      offsetBytes: fingerprint.fileSizeBytes,
      fileMtimeMs: fingerprint.fileMtimeMs,
      fileSizeBytes: fingerprint.fileSizeBytes,
    },
    update: {
      deviceId: fingerprint.deviceId,
      inode: fingerprint.inode,
      offsetBytes: fingerprint.fileSizeBytes,
      fileMtimeMs: fingerprint.fileMtimeMs,
      fileSizeBytes: fingerprint.fileSizeBytes,
    },
  })

  return {
    processedEvents,
    signaturesUpdated,
    daysUpdated,
    cursorReset,
    durationMs: Date.now() - startedAt,
  }
}

function dateRangeFromDays(days: number): { from: Date; to: Date } {
  const to = dayStart(new Date())
  const from = new Date(to)
  from.setUTCDate(from.getUTCDate() - Math.max(1, days) + 1)
  return { from, to: new Date(to.getTime() + 86400_000 - 1) }
}

export async function getErrorSummary(days = 14): Promise<ErrorSummaryResult> {
  const safeDays = Number.isFinite(days) ? Math.max(1, Math.min(90, Math.floor(days))) : 14
  const { from, to } = dateRangeFromDays(safeDays)

  const topRows = await prisma.errorSignatureAggregate.findMany({
    orderBy: { count: 'desc' },
    take: 15,
  })

  const dailyRows = await prisma.errorDailyAggregate.findMany({
    where: {
      day: {
        gte: from,
        lte: to,
      },
    },
    orderBy: { day: 'asc' },
  })

  const trend = dailyRows.map((row) => ({
    day: row.day.toISOString(),
    count: row.count.toString(),
  }))

  const totalErrors = dailyRows.reduce((sum, row) => sum + row.count, 0n)

  const yesterdayStart = dayStart(new Date())
  yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1)
  const yesterdayIso = yesterdayStart.toISOString()

  const yesterdayCount = Number(dailyRows.find((row) => row.day.toISOString() === yesterdayIso)?.count ?? 0n)

  const baselineEnd = new Date(yesterdayStart)
  baselineEnd.setUTCDate(baselineEnd.getUTCDate() - 1)
  const baselineStart = new Date(baselineEnd)
  baselineStart.setUTCDate(baselineStart.getUTCDate() - 6)

  const baselineRows = dailyRows.filter((row) => row.day >= baselineStart && row.day <= baselineEnd)
  const baseline = baselineRows.length > 0
    ? baselineRows.reduce((sum, row) => sum + Number(row.count), 0) / baselineRows.length
    : 0

  const spikeDetected = baseline >= 3 && yesterdayCount >= baseline * 2

  return {
    generatedAt: new Date().toISOString(),
    from: from.toISOString(),
    to: to.toISOString(),
    trend,
    totals: {
      totalErrors: totalErrors.toString(),
      uniqueSignatures: await prisma.errorSignatureAggregate.count(),
    },
    topSignatures: topRows.map((row) => ({
      signatureHash: row.signatureHash,
      signatureText: row.signatureText,
      count: row.count.toString(),
      firstSeen: row.firstSeenAt.toISOString(),
      lastSeen: row.lastSeenAt.toISOString(),
      sample: row.lastSampleSanitized,
    })),
    spike: {
      detected: spikeDetected,
      yesterdayCount,
      baseline: Math.round(baseline * 100) / 100,
    },
  }
}
