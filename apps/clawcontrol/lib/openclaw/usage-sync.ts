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
  filesTotal: number
  filesRemaining: number
  coveragePct: number
  durationMs: number
}

interface UsageDailyDelta {
  modelKey: string
  model: string | null
  dayStart: Date
  inputTokens: bigint
  outputTokens: bigint
  cacheReadTokens: bigint
  cacheWriteTokens: bigint
  totalTokens: bigint
  totalCostMicros: bigint
}

interface UsageHourlyDelta {
  modelKey: string
  model: string | null
  hourStart: Date
  inputTokens: bigint
  outputTokens: bigint
  cacheReadTokens: bigint
  cacheWriteTokens: bigint
  totalTokens: bigint
  totalCostMicros: bigint
}

interface ToolDailyDelta {
  dayStart: Date
  toolName: string
  callCount: bigint
}

interface SessionDelta {
  model: string | null
  sessionKey: string | null
  source: string | null
  channel: string | null
  sessionKind: string | null
  sessionClass: string | null
  providerKey: string | null
  operationId: string | null
  workOrderId: string | null
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
  dailyUsage: Map<string, UsageDailyDelta>
  hourlyUsage: Map<string, UsageHourlyDelta>
  dailyToolCalls: Map<string, ToolDailyDelta>
}

interface UsageCursorState {
  sourcePath: string
  deviceId: bigint
  inode: bigint
  offsetBytes: bigint
  fileMtimeMs: bigint
  fileSizeBytes: bigint
  updatedAt: Date
}

interface UsageCursorOrderingState {
  updatedAt: Date
}

interface SessionOverlay {
  sessionKey: string | null
  source: string | null
  channel: string | null
  sessionKind: string | null
  operationId: string | null
  workOrderId: string | null
}

function getOpenClawHome(): string {
  return process.env.OPENCLAW_HOME || join(homedir(), '.openclaw')
}

function toBigInt(value: number | bigint): bigint {
  if (typeof value === 'bigint') return value
  if (!Number.isFinite(value)) return 0n
  return BigInt(Math.trunc(value))
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function startOfUtcHour(date: Date): Date {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    0,
    0,
    0
  ))
}

function normalizeText(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeLabel(input: string | null | undefined): string | null {
  const value = normalizeText(input)
  return value ? value.toLowerCase() : null
}

function normalizeModel(input: string | null | undefined): string | null {
  const trimmed = normalizeText(input)
  return trimmed
}

function normalizeModelKey(input: string | null | undefined): string {
  const model = normalizeModel(input)
  return model ? model.toLowerCase() : 'unknown'
}

export function deriveProviderKey(model: string | null | undefined): string {
  const normalized = normalizeLabel(model)
  if (!normalized) return 'unknown'

  if (normalized.startsWith('anthropic/') || normalized.startsWith('claude')) return 'anthropic'
  if (normalized.startsWith('openai-codex/') || normalized.includes('codex')) return 'openai-codex'
  if (normalized.startsWith('openai/') || normalized.startsWith('gpt-')) return 'openai'
  if (normalized.startsWith('google/') || normalized.startsWith('gemini')) return 'google'
  if (normalized.startsWith('mistral/')) return 'mistral'
  if (normalized.startsWith('deepseek/')) return 'deepseek'
  if (normalized.startsWith('xai/') || normalized.startsWith('grok')) return 'xai'

  const slash = normalized.indexOf('/')
  if (slash > 0) {
    return normalized.slice(0, slash)
  }

  return 'unknown'
}

function deriveSourceFromSessionKey(sessionKey: string | null): string | null {
  if (!sessionKey) return null
  const first = sessionKey.split(':')[0] ?? ''
  const source = normalizeLabel(first)
  if (!source) return null

  const sourceMap: Record<string, string> = {
    agent: 'overlay',
    webchat: 'web',
    browser: 'web',
    telegram: 'telegram',
    discord: 'discord',
    signal: 'signal',
    whatsapp: 'whatsapp',
    matrix: 'matrix',
    slack: 'slack',
    teams: 'teams',
  }

  return sourceMap[source] ?? source
}

function hasCronMarker(value: string | null): boolean {
  if (!value) return false
  const normalized = value.toLowerCase()
  return (
    normalized.includes('cron')
    || normalized.includes('heartbeat')
    || normalized.includes('scheduler')
    || normalized.includes('scheduled')
  )
}

function sessionClassRank(value: string | null | undefined): number {
  if (value === 'background_cron') return 4
  if (value === 'background_workflow') return 3
  if (value === 'interactive') return 2
  if (value === 'unknown') return 1
  return 0
}

function pickSessionClass(current: string | null, candidate: string | null): string | null {
  return sessionClassRank(candidate) > sessionClassRank(current) ? candidate : current
}

export function deriveSessionClass(input: {
  source: string | null
  channel: string | null
  sessionKey: string | null
  sessionKind: string | null
  operationId: string | null
  workOrderId: string | null
}): string {
  if (
    hasCronMarker(input.source)
    || hasCronMarker(input.channel)
    || hasCronMarker(input.sessionKey)
    || hasCronMarker(input.sessionKind)
  ) {
    return 'background_cron'
  }

  if (input.operationId || input.workOrderId) {
    return 'background_workflow'
  }

  if (input.source || input.channel || input.sessionKey || input.sessionKind) {
    return 'interactive'
  }

  return 'unknown'
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalized = normalizeText(value)
    if (normalized) return normalized
  }

  return null
}

function hasMeaningfulDelta(delta: SessionDelta): boolean {
  return (
    delta.inputTokens !== 0n
    || delta.outputTokens !== 0n
    || delta.cacheReadTokens !== 0n
    || delta.cacheWriteTokens !== 0n
    || delta.totalTokens !== 0n
    || delta.totalCostMicros !== 0n
    || delta.toolCalls.size > 0
    || delta.hasErrors
    || delta.dailyUsage.size > 0
    || delta.hourlyUsage.size > 0
    || delta.dailyToolCalls.size > 0
    || delta.sessionKey !== null
    || delta.source !== null
    || delta.channel !== null
    || delta.sessionKind !== null
    || delta.sessionClass !== null
    || delta.operationId !== null
    || delta.workOrderId !== null
  )
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

export function buildSyncFileQueue(
  files: string[],
  cursorsByPath: Map<string, UsageCursorOrderingState>
): string[] {
  const unseen: string[] = []
  const seen: string[] = []

  for (const filePath of files) {
    if (cursorsByPath.has(filePath)) {
      seen.push(filePath)
    } else {
      unseen.push(filePath)
    }
  }

  unseen.sort((a, b) => a.localeCompare(b))
  seen.sort((a, b) => {
    const aCursor = cursorsByPath.get(a)
    const bCursor = cursorsByPath.get(b)
    const aMs = aCursor?.updatedAt?.getTime() ?? 0
    const bMs = bCursor?.updatedAt?.getTime() ?? 0
    if (aMs !== bMs) return aMs - bMs
    return a.localeCompare(b)
  })

  return unseen.concat(seen)
}

function emptyDelta(): SessionDelta {
  return {
    model: null,
    sessionKey: null,
    source: null,
    channel: null,
    sessionKind: null,
    sessionClass: null,
    providerKey: null,
    operationId: null,
    workOrderId: null,
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
    dailyUsage: new Map<string, UsageDailyDelta>(),
    hourlyUsage: new Map<string, UsageHourlyDelta>(),
    dailyToolCalls: new Map<string, ToolDailyDelta>(),
  }
}

function extractSessionOverlay(rawJson: string | null): { source: string | null; channel: string | null } {
  if (!rawJson) return { source: null, channel: null }

  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>
    const channel = normalizeLabel(
      typeof parsed.channel === 'string'
        ? parsed.channel
        : typeof parsed.chatType === 'string'
          ? parsed.chatType
          : null
    )

    return {
      channel,
      source: channel,
    }
  } catch {
    return { source: null, channel: null }
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

    const model = normalizeModel(parsed.model)
    const modelKey = normalizeModelKey(model)
    const providerKey = deriveProviderKey(model)
    const dayStart = startOfUtcDay(parsed.seenAt)
    const dayStartIso = dayStart.toISOString()
    const hourStart = startOfUtcHour(parsed.seenAt)
    const hourStartIso = hourStart.toISOString()

    const dailyKey = `${dayStartIso}::${modelKey}`
    const hourlyKey = `${hourStartIso}::${modelKey}`

    const parsedSessionKey = normalizeText(parsed.sessionKey)
    const parsedSource = normalizeLabel(parsed.source)
    const parsedChannel = normalizeLabel(parsed.channel)
    const parsedKind = normalizeLabel(parsed.kind)
    const parsedOperationId = normalizeText(parsed.operationId)
    const parsedWorkOrderId = normalizeText(parsed.workOrderId)

    delta.model = model ?? delta.model
    delta.providerKey = normalizeLabel(delta.providerKey) ?? (providerKey !== 'unknown' ? providerKey : null)
    delta.sessionKey = delta.sessionKey ?? parsedSessionKey
    delta.source = delta.source ?? parsedSource
    delta.channel = delta.channel ?? parsedChannel
    delta.sessionKind = delta.sessionKind ?? parsedKind
    delta.operationId = delta.operationId ?? parsedOperationId
    delta.workOrderId = delta.workOrderId ?? parsedWorkOrderId

    delta.sessionClass = pickSessionClass(
      delta.sessionClass,
      deriveSessionClass({
        source: parsedSource,
        channel: parsedChannel,
        sessionKey: parsedSessionKey,
        sessionKind: parsedKind,
        operationId: parsedOperationId,
        workOrderId: parsedWorkOrderId,
      })
    )

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

    const dayBucket = delta.dailyUsage.get(dailyKey) ?? {
      modelKey,
      model,
      dayStart,
      inputTokens: 0n,
      outputTokens: 0n,
      cacheReadTokens: 0n,
      cacheWriteTokens: 0n,
      totalTokens: 0n,
      totalCostMicros: 0n,
    }

    dayBucket.inputTokens += parsed.inputTokens
    dayBucket.outputTokens += parsed.outputTokens
    dayBucket.cacheReadTokens += parsed.cacheReadTokens
    dayBucket.cacheWriteTokens += parsed.cacheWriteTokens
    dayBucket.totalTokens += parsed.totalTokens
    dayBucket.totalCostMicros += parsed.totalCostMicros

    if (!dayBucket.model && model) {
      dayBucket.model = model
    }

    delta.dailyUsage.set(dailyKey, dayBucket)

    const hourBucket = delta.hourlyUsage.get(hourlyKey) ?? {
      modelKey,
      model,
      hourStart,
      inputTokens: 0n,
      outputTokens: 0n,
      cacheReadTokens: 0n,
      cacheWriteTokens: 0n,
      totalTokens: 0n,
      totalCostMicros: 0n,
    }

    hourBucket.inputTokens += parsed.inputTokens
    hourBucket.outputTokens += parsed.outputTokens
    hourBucket.cacheReadTokens += parsed.cacheReadTokens
    hourBucket.cacheWriteTokens += parsed.cacheWriteTokens
    hourBucket.totalTokens += parsed.totalTokens
    hourBucket.totalCostMicros += parsed.totalCostMicros

    if (!hourBucket.model && model) {
      hourBucket.model = model
    }

    delta.hourlyUsage.set(hourlyKey, hourBucket)

    for (const toolName of parsed.toolCalls) {
      const normalizedToolName = normalizeLabel(toolName)
      if (!normalizedToolName) continue

      const prev = delta.toolCalls.get(normalizedToolName) ?? 0n
      delta.toolCalls.set(normalizedToolName, prev + 1n)

      const toolDailyKey = `${dayStartIso}::${normalizedToolName}`
      const dailyTool = delta.dailyToolCalls.get(toolDailyKey) ?? {
        dayStart,
        toolName: normalizedToolName,
        callCount: 0n,
      }

      dailyTool.callCount += 1n
      delta.dailyToolCalls.set(toolDailyKey, dailyTool)
    }
  }

  if (!delta.sessionClass) {
    delta.sessionClass = deriveSessionClass({
      source: delta.source,
      channel: delta.channel,
      sessionKey: delta.sessionKey,
      sessionKind: delta.sessionKind,
      operationId: delta.operationId,
      workOrderId: delta.workOrderId,
    })
  }

  return delta
}

async function upsertUsageCursor(input: {
  sourcePath: string
  agentId: string
  sessionId: string
  fingerprint: {
    deviceId: bigint
    inode: bigint
    fileSizeBytes: bigint
    fileMtimeMs: bigint
  }
}): Promise<void> {
  await prisma.usageIngestionCursor.upsert({
    where: { sourcePath: input.sourcePath },
    create: {
      sourcePath: input.sourcePath,
      agentId: input.agentId,
      sessionId: input.sessionId,
      deviceId: input.fingerprint.deviceId,
      inode: input.fingerprint.inode,
      offsetBytes: input.fingerprint.fileSizeBytes,
      fileMtimeMs: input.fingerprint.fileMtimeMs,
      fileSizeBytes: input.fingerprint.fileSizeBytes,
    },
    update: {
      agentId: input.agentId,
      sessionId: input.sessionId,
      deviceId: input.fingerprint.deviceId,
      inode: input.fingerprint.inode,
      offsetBytes: input.fingerprint.fileSizeBytes,
      fileMtimeMs: input.fingerprint.fileMtimeMs,
      fileSizeBytes: input.fingerprint.fileSizeBytes,
    },
  })
}

async function resolveSessionOverlay(sessionId: string): Promise<SessionOverlay> {
  const row = await prisma.agentSession.findUnique({
    where: { sessionId },
    select: {
      sessionKey: true,
      kind: true,
      rawJson: true,
      operationId: true,
      workOrderId: true,
    },
  })

  if (!row) {
    return {
      sessionKey: null,
      source: null,
      channel: null,
      sessionKind: null,
      operationId: null,
      workOrderId: null,
    }
  }

  const sessionKey = normalizeText(row.sessionKey)
  const parsedOverlay = extractSessionOverlay(row.rawJson)

  return {
    sessionKey,
    source: parsedOverlay.source ?? deriveSourceFromSessionKey(sessionKey),
    channel: parsedOverlay.channel,
    sessionKind: normalizeLabel(row.kind),
    operationId: normalizeText(row.operationId),
    workOrderId: normalizeText(row.workOrderId),
  }
}

async function applyDelta(sessionId: string, agentId: string, delta: SessionDelta): Promise<{ toolsUpserted: number }> {
  const [existing, overlay] = await Promise.all([
    prisma.sessionUsageAggregate.findUnique({
      where: { sessionId },
    }),
    resolveSessionOverlay(sessionId),
  ])

  const sessionKey = firstNonEmpty(delta.sessionKey, overlay.sessionKey, existing?.sessionKey)
  const channel = normalizeLabel(firstNonEmpty(delta.channel, overlay.channel, existing?.channel))
  const source = normalizeLabel(firstNonEmpty(delta.source, overlay.source, existing?.source, deriveSourceFromSessionKey(sessionKey)))
  const sessionKind = normalizeLabel(firstNonEmpty(delta.sessionKind, overlay.sessionKind, existing?.sessionKind))
  const operationId = firstNonEmpty(delta.operationId, overlay.operationId, existing?.operationId)
  const workOrderId = firstNonEmpty(delta.workOrderId, overlay.workOrderId, existing?.workOrderId)
  const providerKey = normalizeLabel(firstNonEmpty(
    delta.providerKey,
    existing?.providerKey,
    deriveProviderKey(delta.model ?? existing?.model)
  )) ?? 'unknown'

  const derivedClass = deriveSessionClass({
    source,
    channel,
    sessionKey,
    sessionKind,
    operationId,
    workOrderId,
  })

  const sessionClass = pickSessionClass(
    pickSessionClass(normalizeLabel(existing?.sessionClass), normalizeLabel(delta.sessionClass)),
    derivedClass
  ) ?? 'unknown'

  if (!existing) {
    await prisma.sessionUsageAggregate.create({
      data: {
        sessionId,
        agentId,
        sessionKey,
        source,
        channel,
        sessionKind,
        sessionClass,
        providerKey,
        operationId,
        workOrderId,
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
        sessionKey,
        source,
        channel,
        sessionKind,
        sessionClass,
        providerKey,
        operationId,
        workOrderId,
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

  for (const daily of delta.dailyUsage.values()) {
    await prisma.sessionUsageDailyAggregate.upsert({
      where: {
        sessionId_dayStart_modelKey: {
          sessionId,
          dayStart: daily.dayStart,
          modelKey: daily.modelKey,
        },
      },
      create: {
        sessionId,
        agentId,
        modelKey: daily.modelKey,
        model: daily.model,
        dayStart: daily.dayStart,
        inputTokens: daily.inputTokens,
        outputTokens: daily.outputTokens,
        cacheReadTokens: daily.cacheReadTokens,
        cacheWriteTokens: daily.cacheWriteTokens,
        totalTokens: daily.totalTokens,
        totalCostMicros: daily.totalCostMicros,
      },
      update: {
        agentId,
        model: daily.model ?? undefined,
        inputTokens: {
          increment: daily.inputTokens,
        },
        outputTokens: {
          increment: daily.outputTokens,
        },
        cacheReadTokens: {
          increment: daily.cacheReadTokens,
        },
        cacheWriteTokens: {
          increment: daily.cacheWriteTokens,
        },
        totalTokens: {
          increment: daily.totalTokens,
        },
        totalCostMicros: {
          increment: daily.totalCostMicros,
        },
      },
    })
  }

  for (const hourly of delta.hourlyUsage.values()) {
    await prisma.sessionUsageHourlyAggregate.upsert({
      where: {
        sessionId_hourStart_modelKey: {
          sessionId,
          hourStart: hourly.hourStart,
          modelKey: hourly.modelKey,
        },
      },
      create: {
        sessionId,
        agentId,
        modelKey: hourly.modelKey,
        model: hourly.model,
        hourStart: hourly.hourStart,
        inputTokens: hourly.inputTokens,
        outputTokens: hourly.outputTokens,
        cacheReadTokens: hourly.cacheReadTokens,
        cacheWriteTokens: hourly.cacheWriteTokens,
        totalTokens: hourly.totalTokens,
        totalCostMicros: hourly.totalCostMicros,
      },
      update: {
        agentId,
        model: hourly.model ?? undefined,
        inputTokens: {
          increment: hourly.inputTokens,
        },
        outputTokens: {
          increment: hourly.outputTokens,
        },
        cacheReadTokens: {
          increment: hourly.cacheReadTokens,
        },
        cacheWriteTokens: {
          increment: hourly.cacheWriteTokens,
        },
        totalTokens: {
          increment: hourly.totalTokens,
        },
        totalCostMicros: {
          increment: hourly.totalCostMicros,
        },
      },
    })
  }

  for (const toolDaily of delta.dailyToolCalls.values()) {
    await prisma.sessionToolUsageDailyAggregate.upsert({
      where: {
        sessionId_dayStart_toolName: {
          sessionId,
          dayStart: toolDaily.dayStart,
          toolName: toolDaily.toolName,
        },
      },
      create: {
        sessionId,
        dayStart: toolDaily.dayStart,
        toolName: toolDaily.toolName,
        callCount: toolDaily.callCount,
      },
      update: {
        callCount: {
          increment: toolDaily.callCount,
        },
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
    filesTotal: 0,
    filesRemaining: 0,
    coveragePct: 100,
    durationMs: 0,
  }

  const files = await listSessionFiles()
  stats.filesTotal = files.length

  if (files.length === 0) {
    stats.durationMs = Date.now() - startedAt
    return stats
  }

  const fileSet = new Set(files)
  const cursorRows = await prisma.usageIngestionCursor.findMany({
    select: {
      sourcePath: true,
      deviceId: true,
      inode: true,
      offsetBytes: true,
      fileMtimeMs: true,
      fileSizeBytes: true,
      updatedAt: true,
    },
  })

  const cursorsByPath = new Map<string, UsageCursorState>()
  for (const cursor of cursorRows) {
    if (!fileSet.has(cursor.sourcePath)) continue
    cursorsByPath.set(cursor.sourcePath, cursor)
  }

  const ordering = new Map<string, UsageCursorOrderingState>()
  for (const [sourcePath, cursor] of cursorsByPath.entries()) {
    ordering.set(sourcePath, { updatedAt: cursor.updatedAt })
  }

  const queue = buildSyncFileQueue(files, ordering)
  const coveredPaths = new Set<string>(cursorsByPath.keys())

  for (const filePath of queue) {
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

    const cursor = cursorsByPath.get(filePath)

    const reset = cursor
      ? shouldResetCursor(cursor, fingerprint)
      : false

    if (reset) stats.cursorResets++

    const previousOffset = reset ? 0n : (cursor?.offsetBytes ?? 0n)

    if (fingerprint.fileSizeBytes <= previousOffset) {
      await upsertUsageCursor({
        sourcePath: filePath,
        agentId: identity.agentId,
        sessionId: identity.sessionId,
        fingerprint,
      })

      coveredPaths.add(filePath)
      stats.filesUpdated++
      continue
    }

    const delta = await parseSessionFileDelta(filePath, previousOffset)

    if (hasMeaningfulDelta(delta)) {
      const applied = await applyDelta(identity.sessionId, identity.agentId, delta)
      stats.sessionsUpdated++
      stats.toolsUpserted += applied.toolsUpserted
    }

    await upsertUsageCursor({
      sourcePath: filePath,
      agentId: identity.agentId,
      sessionId: identity.sessionId,
      fingerprint,
    })

    coveredPaths.add(filePath)
    stats.filesUpdated++
  }

  stats.filesRemaining = Math.max(0, stats.filesTotal - coveredPaths.size)
  stats.coveragePct = stats.filesTotal > 0
    ? Number(((coveredPaths.size / stats.filesTotal) * 100).toFixed(2))
    : 100

  stats.durationMs = Date.now() - startedAt
  return stats
}
