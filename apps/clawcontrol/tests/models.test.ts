import { describe, expect, it } from 'vitest'
import { getModelShortName, inferModelProvider } from '@/lib/models'

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

  it('infers provider for canonical and legacy model identifiers', () => {
    expect(inferModelProvider('anthropic/claude-sonnet-4-5')).toBe('anthropic')
    expect(inferModelProvider('claude-sonnet-4-20250514')).toBe('anthropic')
    expect(inferModelProvider('gpt-5.2')).toBe('openai')
    expect(inferModelProvider('openai-codex/gpt-5.3-codex')).toBe('openai-codex')
    expect(inferModelProvider('unknown-model')).toBe('unknown')
  })
})
