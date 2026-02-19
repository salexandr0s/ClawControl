import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const mocks = vi.hoisted(() => ({
  useSyncStatus: vi.fn(),
  useGatewayStatus: vi.fn(),
  triggerSync: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('@/lib/hooks/useSyncStatus', () => ({
  useSyncStatus: mocks.useSyncStatus,
}))

vi.mock('@/lib/hooks/useGatewayStatus', () => ({
  useGatewayStatus: mocks.useGatewayStatus,
}))

beforeEach(() => {
  vi.resetModules()

  mocks.triggerSync.mockReset()
  mocks.refresh.mockReset()
  mocks.useSyncStatus.mockReset()
  mocks.useGatewayStatus.mockReset()

  mocks.useSyncStatus.mockReturnValue({
    status: {
      bootSync: null,
      lastSync: null,
      gatewayConnected: true,
      stale: false,
      staleMs: null,
    },
    loading: false,
    syncing: false,
    triggerSync: mocks.triggerSync,
  })
})

describe('sync banner gateway contract', () => {
  it('does not show offline banner when status is reachable even if runtime/legacy flag says offline', async () => {
    mocks.useGatewayStatus.mockReturnValue({
      status: 'ok',
      isOnline: false,
      runtimeRunning: false,
      latencyMs: 12,
      lastCheck: '2026-02-18T00:00:00.000Z',
      error: null,
      loading: false,
      refresh: mocks.refresh,
    })

    const { SyncBanner } = await import('@/components/sync-banner')
    const html = renderToStaticMarkup(createElement(SyncBanner))

    expect(html).not.toContain('OpenClaw gateway is offline. Data may be stale.')
  })

  it('shows offline banner when gateway status is unavailable', async () => {
    mocks.useGatewayStatus.mockReturnValue({
      status: 'unavailable',
      isOnline: true,
      runtimeRunning: true,
      latencyMs: 12,
      lastCheck: '2026-02-18T00:00:00.000Z',
      error: 'connect ECONNREFUSED',
      loading: false,
      refresh: mocks.refresh,
    })

    const { SyncBanner } = await import('@/components/sync-banner')
    const html = renderToStaticMarkup(createElement(SyncBanner))

    expect(html).toContain('OpenClaw gateway is offline. Data may be stale.')
  })
})
