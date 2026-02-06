import 'server-only'

import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { normalizeErrorSignature } from './error-signatures'

export interface ParsedErrorEvent {
  occurredAt: Date
  signatureHash: string
  signatureText: string
  sample: string
}

function isEntryStart(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false

  if (/^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}/.test(trimmed)) return true
  if (/^\[[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(trimmed)) return true
  if (/^(ERROR|ERR|FATAL|CRITICAL)\b/i.test(trimmed)) return true
  if (/^\{\s*"(level|time|ts|timestamp)"/i.test(trimmed)) return true

  return false
}

function parseOccurredAt(text: string): Date {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''

  const jsonLike = firstLine.trim()
  if (jsonLike.startsWith('{') && jsonLike.endsWith('}')) {
    try {
      const parsed = JSON.parse(jsonLike) as Record<string, unknown>
      for (const key of ['timestamp', 'time', 'ts']) {
        const value = parsed[key]
        if (typeof value === 'number' && Number.isFinite(value)) {
          const ms = value > 10_000_000_000 ? value : value * 1000
          const d = new Date(ms)
          if (!Number.isNaN(d.getTime())) return d
        }
        if (typeof value === 'string') {
          const d = new Date(value)
          if (!Number.isNaN(d.getTime())) return d
        }
      }
    } catch {
      // Ignore malformed JSON log entries.
    }
  }

  const tsMatch = firstLine.match(/(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/)
  if (tsMatch?.[1]) {
    const parsed = new Date(tsMatch[1].replace(' ', 'T'))
    if (!Number.isNaN(parsed.getTime())) return parsed
  }

  return new Date()
}

async function emitBlock(block: string, onEvent: (event: ParsedErrorEvent) => void): Promise<void> {
  const trimmed = block.trim()
  if (!trimmed) return

  const normalized = normalizeErrorSignature(trimmed)
  onEvent({
    occurredAt: parseOccurredAt(trimmed),
    signatureHash: normalized.signatureHash,
    signatureText: normalized.signatureText,
    sample: normalized.sample,
  })
}

export async function parseGatewayErrorLog(
  filePath: string,
  offsetBytes: bigint,
  onEvent: (event: ParsedErrorEvent) => void,
  options?: {
    shouldStop?: () => boolean
  }
): Promise<void> {
  const stream = createReadStream(filePath, {
    encoding: 'utf8',
    start: Number(offsetBytes),
  })

  const reader = createInterface({
    input: stream,
    crlfDelay: Infinity,
  })

  let current = ''

  for await (const line of reader) {
    if (options?.shouldStop?.()) break

    const trimmed = line.trim()

    if (!trimmed) {
      if (current) {
        await emitBlock(current, onEvent)
        current = ''
      }
      continue
    }

    const startsNew = isEntryStart(line)

    if (startsNew && current) {
      await emitBlock(current, onEvent)
      current = line
      continue
    }

    if (!current) {
      current = line
      continue
    }

    current += `\n${line}`
  }

  if (current) {
    await emitBlock(current, onEvent)
  }
}
