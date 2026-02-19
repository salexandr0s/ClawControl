import 'server-only'

import { promises as fsp } from 'node:fs'
import type { Dirent } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { getOrLoadWithCache } from '@/lib/perf/async-cache'
import { parseSessionIdentity } from '@/lib/openclaw/usage-parser'

const DEFAULT_RANGE_DAYS = 30
const DEFAULT_PARITY_SESSION_LIMIT = 1000
const MAX_PARITY_SESSION_LIMIT = 5000
const QUERY_TTL_MS = 15_000
const SQLITE_IN_LIMIT = 900

type UsageParityScopeRangeInput = {
  from: Date | string | null | undefined
  to: Date | string | null | undefined
}

type UsageParityScopeInput = UsageParityScopeRangeInput & {
  sessionLimit?: number | null
}

type SessionCandidate = {
  sourcePath: string
  sessionId: string
  mtimeMs: number
  deviceId: bigint
  inode: bigint
  fileSizeBytes: bigint
  fileMtimeMs: bigint
}

type CursorRow = {
  sourcePath: string
  deviceId: bigint
  inode: bigint
  offsetBytes: bigint
  fileMtimeMs: bigint
  fileSizeBytes: bigint
}

export type UsageParityScopeResult = {
  from: string
  to: string
  sessionLimit: number
  sessionIdsSampled: string[]
  sampledCount: number
  sessionsInRangeTotal: number
  priorityPaths: string[]
  missingCoverageCount: number
}

function getOpenClawHome(): string {
  return process.env.OPENCLAW_HOME || join(homedir(), '.openclaw')
}

function normalizeNowMs(): number {
  return Math.floor(Date.now() / 60_000) * 60_000
}

function parseDate(input: Date | string | null | undefined, fallback: Date): Date {
  if (input instanceof Date && !Number.isNaN(input.getTime())) return input
  if (typeof input === 'string' && input.trim()) {
    const parsed = new Date(input)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return fallback
}

function resolveRange(input: UsageParityScopeRangeInput): { from: Date; to: Date } {
  const roundedNow = normalizeNowMs()
  const fallbackTo = new Date(roundedNow)
  const fallbackFrom = new Date(roundedNow - DEFAULT_RANGE_DAYS * 86_400_000)

  let from = parseDate(input.from, fallbackFrom)
  let to = parseDate(input.to, fallbackTo)

  if (from.getTime() > to.getTime()) {
    const swap = from
    from = to
    to = swap
  }

  return { from, to }
}

function normalizeSessionLimit(input: number | null | undefined): number {
  if (!Number.isFinite(input)) return DEFAULT_PARITY_SESSION_LIMIT
  const parsed = Math.floor(input as number)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PARITY_SESSION_LIMIT
  return Math.min(MAX_PARITY_SESSION_LIMIT, parsed)
}

async function listSessionCandidates(fromMs: number): Promise<SessionCandidate[]> {
  const agentsDir = join(getOpenClawHome(), 'agents')

  let agentEntries: Dirent[] = []
  try {
    agentEntries = await fsp.readdir(agentsDir, { withFileTypes: true })
  } catch {
    return []
  }

  const candidates: SessionCandidate[] = []

  for (const agentEntry of agentEntries) {
    if (!agentEntry.isDirectory()) continue

    const sessionsDir = join(agentsDir, agentEntry.name, 'sessions')

    let sessionEntries: Dirent[] = []
    try {
      sessionEntries = await fsp.readdir(sessionsDir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const sessionEntry of sessionEntries) {
      if (!sessionEntry.isFile() || !sessionEntry.name.endsWith('.jsonl')) continue

      const sourcePath = join(sessionsDir, sessionEntry.name)
      const identity = parseSessionIdentity(sourcePath)
      if (!identity) continue

      let stat: Awaited<ReturnType<typeof fsp.stat>>
      try {
        stat = await fsp.stat(sourcePath, { bigint: true })
      } catch {
        continue
      }

      const mtimeMs = Number(stat.mtimeMs)
      if (!Number.isFinite(mtimeMs) || mtimeMs < fromMs) continue

      candidates.push({
        sourcePath,
        sessionId: identity.sessionId,
        mtimeMs,
        deviceId: stat.dev,
        inode: stat.ino,
        fileSizeBytes: stat.size,
        fileMtimeMs: BigInt(Math.trunc(mtimeMs)),
      })
    }
  }

  candidates.sort((a, b) => {
    if (a.mtimeMs !== b.mtimeMs) return b.mtimeMs - a.mtimeMs
    return a.sourcePath.localeCompare(b.sourcePath)
  })

  return candidates
}

async function fetchCursorsByPath(sourcePaths: string[]): Promise<Map<string, CursorRow>> {
  if (sourcePaths.length === 0) return new Map()

  const chunks: string[][] = []
  for (let index = 0; index < sourcePaths.length; index += SQLITE_IN_LIMIT) {
    chunks.push(sourcePaths.slice(index, index + SQLITE_IN_LIMIT))
  }

  const rows = await Promise.all(
    chunks.map((subset) =>
      prisma.usageIngestionCursor.findMany({
        where: {
          sourcePath: { in: subset },
        },
        select: {
          sourcePath: true,
          deviceId: true,
          inode: true,
          offsetBytes: true,
          fileMtimeMs: true,
          fileSizeBytes: true,
        },
      })
    )
  )

  const byPath = new Map<string, CursorRow>()
  for (const batch of rows) {
    for (const row of batch) {
      byPath.set(row.sourcePath, row)
    }
  }

  return byPath
}

function hasCursorCoverage(cursor: CursorRow | undefined, candidate: SessionCandidate): boolean {
  if (!cursor) return false
  if (cursor.deviceId !== candidate.deviceId) return false
  if (cursor.inode !== candidate.inode) return false
  if (cursor.offsetBytes !== candidate.fileSizeBytes) return false
  if (cursor.fileSizeBytes !== candidate.fileSizeBytes) return false
  if (cursor.fileMtimeMs !== candidate.fileMtimeMs) return false
  return true
}

export async function resolveUsageParityScope(input: UsageParityScopeInput): Promise<UsageParityScopeResult> {
  const { from, to } = resolveRange(input)
  const sessionLimit = normalizeSessionLimit(input.sessionLimit)
  const key = `usage.parity.scope:${from.toISOString()}:${to.toISOString()}:limit=${sessionLimit}`

  const { value } = await getOrLoadWithCache(key, QUERY_TTL_MS, async () => {
    const candidates = await listSessionCandidates(from.getTime())
    const sampledCandidates = candidates.slice(0, sessionLimit)
    const sampledSourcePaths = sampledCandidates.map((candidate) => candidate.sourcePath)
    const cursorsByPath = await fetchCursorsByPath(sampledSourcePaths)

    const sampledSessionIds = Array.from(new Set(sampledCandidates.map((candidate) => candidate.sessionId)))
    const sessionsInRangeTotal = new Set(candidates.map((candidate) => candidate.sessionId)).size

    const priorityPaths = sampledCandidates
      .filter((candidate) => !hasCursorCoverage(cursorsByPath.get(candidate.sourcePath), candidate))
      .map((candidate) => candidate.sourcePath)

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      sessionLimit,
      sessionIdsSampled: sampledSessionIds,
      sampledCount: sampledSessionIds.length,
      sessionsInRangeTotal,
      priorityPaths,
      missingCoverageCount: priorityPaths.length,
    } satisfies UsageParityScopeResult
  })

  return value
}
