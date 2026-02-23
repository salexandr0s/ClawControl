import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  discoverLocalConfig: vi.fn(),
  checkGatewayHealth: vi.fn(),
  probeGatewayHealth: vi.fn(),
  readSettings: vi.fn(),
  readSettingsSync: vi.fn(),
}))

vi.mock('@clawcontrol/adapters-openclaw', () => ({
  discoverLocalConfig: mocks.discoverLocalConfig,
  checkGatewayHealth: mocks.checkGatewayHealth,
  probeGatewayHealth: mocks.probeGatewayHealth,
}))

vi.mock('@/lib/settings/store', () => ({
  readSettings: mocks.readSettings,
  readSettingsSync: mocks.readSettingsSync,
}))

function baseSettings(overrides: Record<string, unknown> = {}) {
  return {
    settings: {
      updatedAt: '2026-02-11T00:00:00.000Z',
      ...overrides,
    },
    path: '/tmp/settings.json',
    migratedFromEnv: false,
    legacyEnvPath: null,
  }
}

beforeEach(() => {
  vi.resetModules()

  delete process.env.OPENCLAW_GATEWAY_HTTP_URL
  delete process.env.OPENCLAW_GATEWAY_WS_URL
  delete process.env.OPENCLAW_GATEWAY_TOKEN
  delete process.env.OPENCLAW_WORKSPACE

  mocks.discoverLocalConfig.mockReset()
  mocks.checkGatewayHealth.mockReset()
  mocks.probeGatewayHealth.mockReset()
  mocks.readSettings.mockReset()
  mocks.readSettingsSync.mockReset()

  mocks.discoverLocalConfig.mockResolvedValue(null)
  mocks.readSettings.mockResolvedValue(baseSettings())
  mocks.readSettingsSync.mockReturnValue(baseSettings())
})

describe('openclaw client loopback enforcement', () => {
  it('falls back to default loopback URL when discovered gateway is non-loopback', async () => {
    mocks.discoverLocalConfig.mockResolvedValueOnce({
      gatewayUrl: 'https://gateway.remote.example',
      gatewayWsUrl: 'wss://gateway.remote.example',
      token: 'remote-token',
      workspacePath: '/tmp/workspace',
      agents: [],
      configPath: '/tmp/openclaw.json',
      configPaths: ['/tmp/openclaw.json'],
      source: 'openclaw.json',
    })

    const mod = await import('@/lib/openclaw-client')
    const resolved = await mod.getOpenClawConfig(true)

    expect(resolved).not.toBeNull()
    expect(resolved?.gatewayUrl).toBe('http://127.0.0.1:18789')
    expect(resolved?.gatewayWsUrl).toBe('ws://127.0.0.1:18789')
  })

  it('prefers the first loopback URL source when higher-priority source is non-loopback', async () => {
    mocks.readSettings.mockResolvedValueOnce(
      baseSettings({
        gatewayHttpUrl: 'https://gateway.remote.example',
      })
    )
    process.env.OPENCLAW_GATEWAY_HTTP_URL = 'http://127.0.0.1:28888'

    const mod = await import('@/lib/openclaw-client')
    const resolved = await mod.getOpenClawConfig(true)

    expect(resolved).not.toBeNull()
    expect(resolved?.gatewayUrl).toBe('http://127.0.0.1:28888')
    expect(resolved?.resolution.gatewayUrlSource).toBe('env')
  })

  it('sync resolution ignores non-loopback env URL and returns loopback default', async () => {
    process.env.OPENCLAW_GATEWAY_HTTP_URL = 'https://gateway.remote.example'

    const mod = await import('@/lib/openclaw-client')
    const resolved = mod.getOpenClawConfigSync()

    expect(resolved).not.toBeNull()
    expect(resolved?.gatewayUrl).toBe('http://127.0.0.1:18789')
    expect(resolved?.gatewayWsUrl).toBe('ws://127.0.0.1:18789')
  })

  it('derives WS from selected HTTP source instead of mixing cross-source WS URLs', async () => {
    mocks.readSettings.mockResolvedValueOnce(
      baseSettings({
        gatewayHttpUrl: 'http://127.0.0.1:28888',
      })
    )
    process.env.OPENCLAW_GATEWAY_WS_URL = 'ws://127.0.0.1:19999'

    const mod = await import('@/lib/openclaw-client')
    const resolved = await mod.getOpenClawConfig(true)

    expect(resolved).not.toBeNull()
    expect(resolved?.gatewayUrl).toBe('http://127.0.0.1:28888')
    expect(resolved?.gatewayWsUrl).toBe('ws://127.0.0.1:28888')
    expect(resolved?.resolution.gatewayUrlSource).toBe('settings')
    expect(resolved?.resolution.gatewayWsUrlSource).toBe('settings')
  })

  it('sync resolution keeps same-source WS only when endpoint-equivalent', async () => {
    mocks.readSettingsSync.mockReturnValue(
      baseSettings({
        gatewayHttpUrl: 'http://127.0.0.1:18789',
        gatewayWsUrl: 'ws://127.0.0.1:28888',
      })
    )

    const mod = await import('@/lib/openclaw-client')
    const resolved = mod.getOpenClawConfigSync()

    expect(resolved).not.toBeNull()
    expect(resolved?.gatewayUrl).toBe('http://127.0.0.1:18789')
    expect(resolved?.gatewayWsUrl).toBe('ws://127.0.0.1:18789')
    expect(resolved?.resolution.gatewayUrlSource).toBe('settings')
    expect(resolved?.resolution.gatewayWsUrlSource).toBe('settings')
  })
})
