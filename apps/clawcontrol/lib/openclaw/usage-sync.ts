import 'server-only'

import { createReadStream } from 'node:fs'
import { promises as fsp } from 'node:fs'
import type { Dirent } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { prisma } from '@/lib/db'
import { parseSessionIdentity, parseUsageLine } from './usage-parser'

export interface UsageSyncOptions {
  maxMs?: number
  maxFiles?: number
}

export interface UsageSyncStats {
  filesScanned: number
  filesUpdated: number
  sessionsUpdated: number
  toolsUpserted: number
  cursorResets: number
  durationMs: number
}

interface SessionDelta {
  model: string | null
  inputTokens: bigint
  outputTokens: bigint
  cacheReadTokens: bigint
  cacheWriteTokens: bigint
  totalTokens: bigint
  totalCostMicros: bigint
  hasErrors: boolean
  firstSeenAt: Date | null
  lastSeenAt: Date | null
  toolCalls: Map<string, bigint>
}

function getOpenClawHome(): string {
  return process.env.OPENCLAW_HOME || join(homedir(), '.openclaw')
}

function toBigInt(value: number | bigint): bigint {
  if (typeof value === 'bigint') return value
  if (!Number.isFinite(value)) return 0n
  return BigInt(Math.trunc(value))
}

function deriveStatFingerprint(stat: {
  dev: number | bigint
  ino: number | bigint
  size: number | bigint
  mtimeMs: number
}): {
  deviceId: bigint
  inode: bigint
  fileSizeBytes: bigint
  fileMtimeMs: bigint
} {
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

  // Rotation/rewrite safety: older mtime with changed size is suspicious.
  if (next.fileMtimeMs < cursor.fileMtimeMs && next.fileSizeBytes !== cursor.fileSizeBytes) return true

  return false
}

async function listSessionFiles(): Promise<string[]> {
  const openClawHome = getOpenClawHome()
  const agentsDir = join(openClawHome, 'agents')

  let agentEntries: Dirent[] = []
  try {
    agentEntries = await fsp.readdir(agentsDir, { withFileTypes: true })
  } catch {
    return []
  }

  const files: string[] = []

  for (const ent of agentEntries) {
    if (!ent.isDirectory()) continue

    const sessionsDir = join(agentsDir, ent.name, 'sessions')

    let sessionEntries: Dirent[] = []
    try {
      sessionEntries = await fsp.readdir(sessionsDir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const s of sessionEntries) {
      if (!s.isFile()) continue
      if (!s.name.endsWith('.jsonl')) continue
      files.push(join(sessionsDir, s.name))
    }
  }

  files.sort((a, b) => a.localeCompare(b))
  return files
}

function emptyDelta(): SessionDelta {
  return {
    model: null,
    inputTokens: 0n,
    outputTokens: 0n,
    cacheReadTokens: 0n,
    cacheWriteTokens: 0n,
    totalTokens: 0n,
    totalCostMicros: 0n,
    hasErrors: false,
    firstSeenAt: null,
    lastSeenAt: null,
    toolCalls: new Map<string, bigint>(),
  }
}

async function parseSessionFileDelta(filePath: string, offsetBytes: bigint): Promise<SessionDelta> {
  const delta = emptyDelta()

  const stream = createReadStream(filePath, {
    encoding: 'utf8',
    start: Number(offsetBytes),
  })

  const reader = createInterface({
    input: stream,
    crlfDelay: Infinity,
  })

  for await (const line of reader) {
    const parsed = parseUsageLine(line)
    if (!parsed) continue

    delta.model = parsed.model ?? delta.model
    delta.inputTokens += parsed.inputTokens
    delta.outputTokens += parsed.outputTokens
    delta.cacheReadTokens += parsed.cacheReadTokens
    delta.cacheWriteTokens += parsed.cacheWriteTokens
    delta.totalTokens += parsed.totalTokens
    delta.totalCostMicros += parsed.totalCostMicros
    delta.hasErrors = delta.hasErrors || parsed.hasError

    if (!delta.firstSeenAt || parsed.seenAt < delta.firstSeenAt) {
      delta.firstSeenAt = parsed.seenAt
    }
    if (!delta.lastSeenAt || parsed.seenAt > delta.lastSeenAt) {
      delta.lastSeenAt = parsed.seenAt
    }

    for (const toolName of parsed.toolCalls) {
      const prev = delta.toolCalls.get(toolName) ?? 0n
      delta.toolCalls.set(toolName, prev + 1n)
    }
  }

  return delta
}

async function applyDelta(sessionId: string, agentId: string, delta: SessionDelta): Promise<{ toolsUpserted: number }> {
  const existing = await prisma.sessionUsageAggregate.findUnique({
    where: { sessionId },
  })

  if (!existing) {
    await prisma.sessionUsageAggregate.create({
      data: {
        sessionId,
        agentId,
        model: delta.model,
        inputTokens: delta.inputTokens,
        outputTokens: delta.outputTokens,
        cacheReadTokens: delta.cacheReadTokens,
        cacheWriteTokens: delta.cacheWriteTokens,
        totalTokens: delta.totalTokens,
        totalCostMicros: delta.totalCostMicros,
        hasErrors: delta.hasErrors,
        firstSeenAt: delta.firstSeenAt,
        lastSeenAt: delta.lastSeenAt,
      },
    })
  } else {
    await prisma.sessionUsageAggregate.update({
      where: { sessionId },
      data: {
        agentId,
        model: delta.model ?? existing.model,
        inputTokens: existing.inputTokens + delta.inputTokens,
        outputTokens: existing.outputTokens + delta.outputTokens,
        cacheReadTokens: existing.cacheReadTokens + delta.cacheReadTokens,
        cacheWriteTokens: existing.cacheWriteTokens + delta.cacheWriteTokens,
        totalTokens: existing.totalTokens + delta.totalTokens,
        totalCostMicros: existing.totalCostMicros + delta.totalCostMicros,
        hasErrors: existing.hasErrors || delta.hasErrors,
        firstSeenAt:
          existing.firstSeenAt && delta.firstSeenAt
            ? (existing.firstSeenAt < delta.firstSeenAt ? existing.firstSeenAt : delta.firstSeenAt)
            : (existing.firstSeenAt ?? delta.firstSeenAt),
        lastSeenAt:
          existing.lastSeenAt && delta.lastSeenAt
            ? (existing.lastSeenAt > delta.lastSeenAt ? existing.lastSeenAt : delta.lastSeenAt)
            : (existing.lastSeenAt ?? delta.lastSeenAt),
      },
    })
  }

  let toolsUpserted = 0

  for (const [toolName, callCount] of delta.toolCalls.entries()) {
    await prisma.sessionToolUsage.upsert({
      where: {
        sessionId_toolName: {
          sessionId,
          toolName,
        },
      },
      create: {
        sessionId,
        toolName,
        callCount,
      },
      update: {
        callCount: {
          increment: callCount,
        },
      },
    })
    toolsUpserted++
  }

  return { toolsUpserted }
}

export async function syncUsageTelemetry(options: UsageSyncOptions = {}): Promise<UsageSyncStats> {
  const startedAt = Date.now()
  const maxMs = options.maxMs ?? 15_000
  const maxFiles = options.maxFiles ?? 400

  const stats: UsageSyncStats = {
    filesScanned: 0,
    filesUpdated: 0,
    sessionsUpdated: 0,
    toolsUpserted: 0,
    cursorResets: 0,
    durationMs: 0,
  }

  const files = await listSessionFiles()

  for (const filePath of files) {
    if (stats.filesScanned >= maxFiles) break
    if (Date.now() - startedAt > maxMs) break

    stats.filesScanned++

    const identity = parseSessionIdentity(filePath)
    if (!identity) continue

    let stat: Awaited<ReturnType<typeof fsp.stat>>
    try {
      stat = await fsp.stat(filePath, { bigint: true })
    } catch {
      continue
    }

    const fingerprint = deriveStatFingerprint({
      dev: stat.dev,
      ino: stat.ino,
      size: stat.size,
      mtimeMs: Number(stat.mtimeMs),
    })

    const cursor = await prisma.usageIngestionCursor.findUnique({
      where: { sourcePath: filePath },
    })

    const reset = cursor
      ? shouldResetCursor(cursor, fingerprint)
      : false

    if (reset) stats.cursorResets++

    const previousOffset = reset ? 0n : (cursor?.offsetBytes ?? 0n)

    if (fingerprint.fileSizeBytes <= previousOffset) {
      await prisma.usageIngestionCursor.upsert({
        where: { sourcePath: filePath },
        create: {
          sourcePath: filePath,
          agentId: identity.agentId,
          sessionId: identity.sessionId,
          deviceId: fingerprint.deviceId,
          inode: fingerprint.inode,
          offsetBytes: fingerprint.fileSizeBytes,
          fileMtimeMs: fingerprint.fileMtimeMs,
          fileSizeBytes: fingerprint.fileSizeBytes,
        },
        update: {
          agentId: identity.agentId,
          sessionId: identity.sessionId,
          deviceId: fingerprint.deviceId,
          inode: fingerprint.inode,
          offsetBytes: fingerprint.fileSizeBytes,
          fileMtimeMs: fingerprint.fileMtimeMs,
          fileSizeBytes: fingerprint.fileSizeBytes,
        },
      })
      continue
    }

    const delta = await parseSessionFileDelta(filePath, previousOffset)

    if (
      delta.inputTokens !== 0n
      || delta.outputTokens !== 0n
      || delta.cacheReadTokens !== 0n
      || delta.cacheWriteTokens !== 0n
      || delta.totalTokens !== 0n
      || delta.totalCostMicros !== 0n
      || delta.toolCalls.size > 0
      || delta.hasErrors
    ) {
      const applied = await applyDelta(identity.sessionId, identity.agentId, delta)
      stats.sessionsUpdated++
      stats.toolsUpserted += applied.toolsUpserted
    }

    await prisma.usageIngestionCursor.upsert({
      where: { sourcePath: filePath },
      create: {
        sourcePath: filePath,
        agentId: identity.agentId,
        sessionId: identity.sessionId,
        deviceId: fingerprint.deviceId,
        inode: fingerprint.inode,
        offsetBytes: fingerprint.fileSizeBytes,
        fileMtimeMs: fingerprint.fileMtimeMs,
        fileSizeBytes: fingerprint.fileSizeBytes,
      },
      update: {
        agentId: identity.agentId,
        sessionId: identity.sessionId,
        deviceId: fingerprint.deviceId,
        inode: fingerprint.inode,
        offsetBytes: fingerprint.fileSizeBytes,
        fileMtimeMs: fingerprint.fileMtimeMs,
        fileSizeBytes: fingerprint.fileSizeBytes,
      },
    })

    stats.filesUpdated++
  }

  stats.durationMs = Date.now() - startedAt
  return stats
}
