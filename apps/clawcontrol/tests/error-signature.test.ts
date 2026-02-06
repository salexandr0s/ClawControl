import { describe, it, expect } from 'vitest'
import { normalizeErrorSignature, sanitizeErrorSample } from '@/lib/openclaw/error-signatures'

describe('error-signatures', () => {
  it('normalizes volatile values into stable signature', () => {
    const a = normalizeErrorSignature(`2026-02-06T12:00:00Z ERROR Request 12345 failed\n at foo (/tmp/a.ts:33:9)`)
    const b = normalizeErrorSignature(`2026-02-07T12:10:00Z ERROR Request 67890 failed\n at foo (/tmp/b.ts:87:11)`)

    expect(a.signatureHash).toBe(b.signatureHash)
    expect(a.signatureText).toContain('<ts>')
  })

  it('sanitizes control chars and truncates samples', () => {
    const sample = sanitizeErrorSample('hello\u0000world\n'.repeat(80), 50)
    expect(sample.includes('\u0000')).toBe(false)
    expect(sample.length).toBeLessThanOrEqual(50)
  })
})
