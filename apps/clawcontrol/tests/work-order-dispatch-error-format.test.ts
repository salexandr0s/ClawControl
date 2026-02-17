import { describe, expect, it } from 'vitest'
import { buildDispatchErrorDisplay } from '@/lib/work-orders/dispatch-error'

describe('work order dispatch error formatting', () => {
  it('returns concise summary for fallback auth failures and preserves raw details', () => {
    const raw = [
      'openclaw run unavailable; fallback agent_local failed.',
      "run_error=error: unknown command 'run' (Did you mean cron?)",
      'agent_local_error=FailoverError: No API key found for provider "openai".',
    ].join('\n')

    const display = buildDispatchErrorDisplay(raw)
    expect(display.summary).toContain('OpenAI authentication is missing')
    expect(display.raw).toBe(raw)
    expect(display.hint).toContain('OPENAI_API_KEY')
  })

  it('uses first meaningful line for unknown dispatch errors', () => {
    const raw = 'Dispatch timeout exceeded while waiting for session response.\ntrace line 1\ntrace line 2'
    const display = buildDispatchErrorDisplay(raw)

    expect(display.summary).toBe('Dispatch timeout exceeded while waiting for session response.')
    expect(display.raw).toBe(raw)
  })
})
