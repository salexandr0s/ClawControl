import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {},
}))

import { deriveSessionClass, deriveProviderKey } from '@/lib/openclaw/usage-sync'

describe('usage session classification', () => {
  it('classifies cron/background/workflow/interactive/unknown deterministically', () => {
    expect(deriveSessionClass({
      source: 'cron',
      channel: null,
      sessionKey: null,
      sessionKind: null,
      operationId: null,
      workOrderId: null,
    })).toBe('background_cron')

    expect(deriveSessionClass({
      source: 'overlay',
      channel: null,
      sessionKey: 'agent:main:wo:wo_1234567890:op:op_1234567890',
      sessionKind: 'unknown',
      operationId: 'op_1234567890',
      workOrderId: 'wo_1234567890',
    })).toBe('background_workflow')

    expect(deriveSessionClass({
      source: 'web',
      channel: 'telegram',
      sessionKey: 'telegram:main:chat',
      sessionKind: 'chat',
      operationId: null,
      workOrderId: null,
    })).toBe('interactive')

    expect(deriveSessionClass({
      source: null,
      channel: null,
      sessionKey: null,
      sessionKind: null,
      operationId: null,
      workOrderId: null,
    })).toBe('unknown')
  })

  it('normalizes providers from model names', () => {
    expect(deriveProviderKey('claude-opus-4-5')).toBe('anthropic')
    expect(deriveProviderKey('gpt-5.2')).toBe('openai')
    expect(deriveProviderKey('openai-codex/gpt-5.3-codex')).toBe('openai-codex')
    expect(deriveProviderKey(null)).toBe('unknown')
  })
})
