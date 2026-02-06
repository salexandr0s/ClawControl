import 'server-only'

import { createHash } from 'node:crypto'

export interface NormalizedErrorSignature {
  signatureHash: string
  signatureText: string
  sample: string
}

function stripControlChars(input: string): string {
  let out = ''
  for (const ch of input) {
    const code = ch.charCodeAt(0)
    const isControl = (code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127
    out += isControl ? ' ' : ch
  }
  return out
}

export function sanitizeErrorSample(input: string, maxLen = 320): string {
  const cleaned = stripControlChars(input)
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return ''
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 1)}…` : cleaned
}

function normalizeLine(line: string): string {
  return line
    .replace(/\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, '<ts>')
    .replace(/\[[0-9]{4}-[0-9]{2}-[0-9]{2}[^\]]*\]/g, '[<ts>]')
    .replace(/0x[0-9a-f]+/gi, '<hex>')
    .replace(/:[0-9]+:[0-9]+\b/g, ':#:#')
    .replace(/:[0-9]+\b/g, ':#')
    .replace(/\b[0-9]{5,}\b/g, '<num>')
    .replace(/\b[0-9]+\b/g, '#')
    .replace(/"[0-9a-f-]{8,}"/gi, '"<id>"')
    .replace(/[A-Z]:\\[^\s]+/g, '<path>')
    .replace(/\/[\w./-]+\.[a-zA-Z]{1,5}/g, '<path>')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeErrorSignature(block: string): NormalizedErrorSignature {
  const lines = block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const headline = lines[0] || 'unknown-error'
  const frame = lines.find((line) => line.startsWith('at ') || /\bat\s+.+:\d+/.test(line))

  const signatureText = [headline, frame]
    .filter(Boolean)
    .map((line) => normalizeLine(line as string))
    .join(' | ')
    .slice(0, 400)

  const signatureHash = createHash('sha1')
    .update(signatureText || 'unknown-error')
    .digest('hex')

  return {
    signatureHash,
    signatureText: signatureText || 'unknown-error',
    sample: sanitizeErrorSample(lines.slice(0, 6).join(' | ')),
  }
}
