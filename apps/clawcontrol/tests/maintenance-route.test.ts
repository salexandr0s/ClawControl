import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getOpenClawRuntimeDependencyStatus: vi.fn(),
  getRepos: vi.fn(),
  getOpenClawConfig: vi.fn(),
  getOpenClawConfigSync: vi.fn(),
}))

vi.mock('@clawcontrol/adapters-openclaw', () => ({
  OPENCLAW_BIN: 'openclaw',
  MIN_OPENCLAW_VERSION: '0.1.0',
}))

vi.mock('@/lib/openclaw/runtime-deps', () => ({
  getOpenClawRuntimeDependencyStatus: mocks.getOpenClawRuntimeDependencyStatus,
}))

vi.mock('@/lib/repo', () => ({
  getRepos: mocks.getRepos,
}))

vi.mock('@/lib/openclaw-client', () => ({
  getOpenClawConfig: mocks.getOpenClawConfig,
  getOpenClawConfigSync: mocks.getOpenClawConfigSync,
}))

beforeEach(() => {
  vi.resetModules()
  mocks.getOpenClawRuntimeDependencyStatus.mockReset()
  mocks.getRepos.mockReset()
  mocks.getOpenClawConfig.mockReset()
  mocks.getOpenClawConfigSync.mockReset()
})

describe('maintenance route', () => {
  it('reports gateway healthy even when CLI is unavailable', async () => {
    mocks.getOpenClawRuntimeDependencyStatus.mockResolvedValue({
      cliAvailable: false,
      cliVersion: null,
      belowMinVersion: false,
      cliError: 'OpenClaw CLI not found',
      resolvedCliBin: '/usr/local/bin/openclaw',
      checkedAt: '2026-02-10T00:00:00.000Z',
      cacheTtlMs: 30_000,
    })

    mocks.getRepos.mockReturnValue({
      gateway: {
        status: vi.fn().mockResolvedValue({
          status: 'ok',
          latencyMs: 18,
          data: { running: true },
          error: null,
          timestamp: '2026-02-10T00:00:00.000Z',
          cached: false,
        }),
        probe: vi.fn().mockResolvedValue({
          status: 'ok',
          latencyMs: 9,
          data: { reachable: true, latencyMs: 9 },
          error: null,
          timestamp: '2026-02-10T00:00:00.000Z',
          cached: false,
        }),
      },
    })

    mocks.getOpenClawConfig.mockResolvedValue({
      gatewayUrl: 'http://127.0.0.1:18789',
      token: null,
    })
    mocks.getOpenClawConfigSync.mockReturnValue(null)

    const route = await import('@/app/api/maintenance/route')
    const response = await route.GET()
    const payload = (await response.json()) as {
      data: {
        health: { status: string }
        cliAvailable: boolean
        probe: { ok: boolean }
        localOnly: { openclawDashboard: { ok: boolean } }
      }
    }

    expect(response.status).toBe(200)
    expect(payload.data.health.status).toBe('ok')
    expect(payload.data.cliAvailable).toBe(false)
    expect(payload.data.probe.ok).toBe(true)
    expect(payload.data.localOnly.openclawDashboard.ok).toBe(true)
  })
})
