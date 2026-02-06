import 'server-only'

import { basename, dirname } from 'node:path'

export interface SessionFileIdentity {
  sourcePath: string
  agentId: string
  sessionId: string
}

export interface ParsedUsageLine {
  seenAt: Date
  model: string | null
  inputTokens: bigint
  outputTokens: bigint
  cacheReadTokens: bigint
  cacheWriteTokens: bigint
  totalTokens: bigint
  totalCostMicros: bigint
  toolCalls: string[]
  hasError: boolean
  hasUsage: boolean
}

type JsonRecord = Record<string, unknown>

type UsageShape = {
  input?: unknown
  inputTokens?: unknown
  output?: unknown
  outputTokens?: unknown
  cacheRead?: unknown
  cacheReadTokens?: unknown
  cacheWrite?: unknown
  cacheWriteTokens?: unknown
  totalTokens?: unknown
  cost?: unknown
}

function toInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.max(0, Math.trunc(value)))
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return BigInt(Math.max(0, Math.trunc(parsed)))
  }
  return 0n
}

function toCostMicros(value: unknown): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.max(0, Math.round(value * 1_000_000)))
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return BigInt(Math.max(0, Math.round(parsed * 1_000_000)))
  }
  return 0n
}

function pickDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 10_000_000_000 ? value : value * 1000
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

function getNestedRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
}

function getUsage(record: JsonRecord): UsageShape | null {
  const direct = getNestedRecord(record.usage)
  if (direct) return direct as UsageShape

  const message = getNestedRecord(record.message)
  if (message) {
    const msgUsage = getNestedRecord(message.usage)
    if (msgUsage) return msgUsage as UsageShape
  }

  const payload = getNestedRecord(record.payload)
  if (payload) {
    const payloadUsage = getNestedRecord(payload.usage)
    if (payloadUsage) return payloadUsage as UsageShape
  }

  return null
}

function getModel(record: JsonRecord): string | null {
  const candidates = [
    record.model,
    getNestedRecord(record.message)?.model,
    getNestedRecord(record.usage)?.model,
    getNestedRecord(getNestedRecord(record.message)?.usage)?.model,
  ]

  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c
  }

  return null
}

function parseCostMicros(cost: unknown): bigint {
  if (!cost) return 0n

  if (typeof cost === 'number' || typeof cost === 'string' || typeof cost === 'bigint') {
    return toCostMicros(cost)
  }

  const obj = getNestedRecord(cost)
  if (!obj) return 0n

  if (obj.total !== undefined) return toCostMicros(obj.total)

  // Fallback: sum known cost components when no `total` is provided.
  return [obj.input, obj.output, obj.cacheRead, obj.cacheWrite]
    .map(toCostMicros)
    .reduce((sum, v) => sum + v, 0n)
}

function getToolCalls(record: JsonRecord): string[] {
  const names = new Set<string>()

  const collectFromContent = (content: unknown): void => {
    if (!Array.isArray(content)) return

    for (const part of content) {
      const item = getNestedRecord(part)
      if (!item) continue

      const type = typeof item.type === 'string' ? item.type : ''
      if (type === 'toolCall' && typeof item.name === 'string' && item.name.trim()) {
        names.add(item.name.trim().toLowerCase())
      }

      const toolCall = getNestedRecord(item.toolCall)
      if (toolCall && typeof toolCall.name === 'string' && toolCall.name.trim()) {
        names.add(toolCall.name.trim().toLowerCase())
      }
    }
  }

  collectFromContent(record.content)
  collectFromContent(getNestedRecord(record.message)?.content)
  collectFromContent(getNestedRecord(record.payload)?.content)

  return Array.from(names)
}

function lineHasError(record: JsonRecord): boolean {
  const level = typeof record.level === 'string' ? record.level.toLowerCase() : ''
  if (level === 'error' || level === 'fatal') return true

  const type = typeof record.type === 'string' ? record.type.toLowerCase() : ''
  if (type.includes('error') || type.includes('exception') || type.includes('failed')) return true

  if (record.error !== undefined || record.err !== undefined || record.exception !== undefined) return true

  const message = getNestedRecord(record.message)
  if (message) {
    const role = typeof message.role === 'string' ? message.role.toLowerCase() : ''
    const text = typeof message.content === 'string' ? message.content.toLowerCase() : ''
    if (role === 'system' && text.includes('error')) return true
    if (message.error !== undefined) return true
  }

  return false
}

export function parseSessionIdentity(sourcePath: string): SessionFileIdentity | null {
  if (!sourcePath.endsWith('.jsonl')) return null

  const sessionId = basename(sourcePath, '.jsonl')
  const sessionsDir = dirname(sourcePath)
  const agentDir = dirname(sessionsDir)
  const sessionsName = basename(sessionsDir)
  const agentId = basename(agentDir)

  if (!sessionId || !agentId || sessionsName !== 'sessions') return null

  return {
    sourcePath,
    agentId,
    sessionId,
  }
}

export function parseUsageLine(line: string): ParsedUsageLine | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }

  const record = getNestedRecord(parsed)
  if (!record) return null

  const usage = getUsage(record)
  const inputTokens = usage ? toInt(usage.inputTokens ?? usage.input) : 0n
  const outputTokens = usage ? toInt(usage.outputTokens ?? usage.output) : 0n
  const cacheReadTokens = usage ? toInt(usage.cacheReadTokens ?? usage.cacheRead) : 0n
  const cacheWriteTokens = usage ? toInt(usage.cacheWriteTokens ?? usage.cacheWrite) : 0n

  const derivedTotal = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens
  const totalTokens = usage
    ? toInt(usage.totalTokens ?? derivedTotal)
    : 0n

  const totalCostMicros = usage ? parseCostMicros(usage.cost) : 0n

  const seenAt =
    pickDate(record.createdAt)
    ?? pickDate(record.timestamp)
    ?? pickDate(record.ts)
    ?? pickDate(getNestedRecord(record.message)?.createdAt)
    ?? new Date()

  const toolCalls = getToolCalls(record)
  const hasError = lineHasError(record)
  const hasUsage = usage !== null

  if (!hasUsage && toolCalls.length === 0 && !hasError) {
    return null
  }

  return {
    seenAt,
    model: getModel(record),
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    totalCostMicros,
    toolCalls,
    hasError,
    hasUsage,
  }
}
