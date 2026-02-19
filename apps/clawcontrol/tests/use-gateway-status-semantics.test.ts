import { describe, expect, it } from 'vitest'
import {
  deriveGatewayStatusState,
  type GatewayStatusPayload,
} from '@/lib/hooks/useGatewayStatus'

function payload(overrides: Partial<GatewayStatusPayload>): GatewayStatusPayload {
  return {
    status: 'ok',
    latencyMs: 12,
    timestamp: '2026-02-18T00:00:00.000Z',
    error: null,
    data: { running: true },
    ...overrides,
  }
}

describe('useGatewayStatus semantics', () => {
  it('treats ok + running=false as online', () => {
    const state = deriveGatewayStatusState(
      payload({
        status: 'ok',
        data: { running: false },
      })
    )

    expect(state.status).toBe('ok')
    expect(state.runtimeRunning).toBe(false)
    expect(state.isOnline).toBe(true)
  })

  it('treats degraded + running=false as online', () => {
    const state = deriveGatewayStatusState(
      payload({
        status: 'degraded',
        data: { running: false },
      })
    )

    expect(state.status).toBe('degraded')
    expect(state.runtimeRunning).toBe(false)
    expect(state.isOnline).toBe(true)
  })

  it('treats unavailable as offline', () => {
    const state = deriveGatewayStatusState(
      payload({
        status: 'unavailable',
        data: { running: true },
      })
    )

    expect(state.status).toBe('unavailable')
    expect(state.isOnline).toBe(false)
  })

  it('returns runtimeRunning=null when runtime flag is missing', () => {
    const state = deriveGatewayStatusState(
      payload({
        data: {},
      })
    )

    expect(state.runtimeRunning).toBeNull()
    expect(state.isOnline).toBe(true)
  })
})
