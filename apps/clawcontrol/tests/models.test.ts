import { describe, expect, it } from 'vitest'
import { getModelShortName } from '@/lib/models'

describe('model labels', () => {
  it('shows versioned names for known configured models', () => {
    expect(getModelShortName('anthropic/claude-opus-4-5')).toBe('Opus 4.5')
    expect(getModelShortName('anthropic/claude-sonnet-4-5')).toBe('Sonnet 4.5')
    expect(getModelShortName('anthropic/claude-3-5-haiku-20241022')).toBe('Haiku 3.5')
  })

  it('parses versioned names from legacy/freeform identifiers', () => {
    expect(getModelShortName('claude-sonnet-4-20250514')).toBe('Sonnet 4')
    expect(getModelShortName('openai-codex/gpt-5.2')).toBe('Codex 5.2')
    expect(getModelShortName('openai/gpt-5.2')).toBe('GPT-5.2')
  })
})
