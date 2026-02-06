import { describe, it, expect } from 'vitest'
import { parseSessionIdentity, parseUsageLine } from '@/lib/openclaw/usage-parser'

describe('usage-parser', () => {
  it('parses session identity from OpenClaw session path', () => {
    const identity = parseSessionIdentity('/tmp/.openclaw/agents/main/sessions/abc123.jsonl')
    expect(identity).toEqual({
      sourcePath: '/tmp/.openclaw/agents/main/sessions/abc123.jsonl',
      agentId: 'main',
      sessionId: 'abc123',
    })
  })

  it('parses usage payload variants and tool calls', () => {
    const line = JSON.stringify({
      createdAt: '2026-02-06T10:00:00.000Z',
      message: {
        usage: {
          input: 100,
          outputTokens: 80,
          cacheRead: 25,
          cacheWriteTokens: 5,
          totalTokens: 210,
          cost: { total: 0.0025 },
        },
        content: [
          { type: 'toolCall', name: 'read_file' },
          { type: 'toolCall', name: 'search' },
        ],
      },
      model: 'claude-sonnet',
    })

    const parsed = parseUsageLine(line)
    expect(parsed).not.toBeNull()
    expect(parsed?.inputTokens).toBe(100n)
    expect(parsed?.outputTokens).toBe(80n)
    expect(parsed?.cacheReadTokens).toBe(25n)
    expect(parsed?.cacheWriteTokens).toBe(5n)
    expect(parsed?.totalTokens).toBe(210n)
    expect(parsed?.totalCostMicros).toBe(2500n)
    expect(parsed?.model).toBe('claude-sonnet')
    expect(parsed?.toolCalls).toEqual(['read_file', 'search'])
  })

  it('marks line as error when explicit error fields are present', () => {
    const line = JSON.stringify({
      timestamp: '2026-02-06T10:01:00.000Z',
      type: 'runner_error',
      error: 'boom',
    })

    const parsed = parseUsageLine(line)
    expect(parsed).not.toBeNull()
    expect(parsed?.hasError).toBe(true)
  })
})
