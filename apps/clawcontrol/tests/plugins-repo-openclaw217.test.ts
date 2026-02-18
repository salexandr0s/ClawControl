import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const adapter = {
    listPlugins: vi.fn(),
    pluginInfo: vi.fn(),
    pluginDoctor: vi.fn(),
    installPlugin: vi.fn(async function* installPluginGenerator() {
      yield 'installed'
    }),
    enablePlugin: vi.fn(),
    disablePlugin: vi.fn(),
    gatewayRestart: vi.fn(),
  }

  return {
    adapter,
    createAdapter: vi.fn(() => adapter),
    runDynamicCommand: vi.fn(),
    getOpenClawCapabilities: vi.fn(),
  }
})

vi.mock('@clawcontrol/adapters-openclaw', () => ({
  createAdapter: mocks.createAdapter,
  runDynamicCommand: mocks.runDynamicCommand,
}))

vi.mock('../lib/openclaw', () => ({
  getOpenClawCapabilities: mocks.getOpenClawCapabilities,
}))

describe('plugins repo OpenClaw 2.17 behavior', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.createAdapter.mockClear()
    mocks.runDynamicCommand.mockReset()
    mocks.getOpenClawCapabilities.mockReset()
    mocks.adapter.listPlugins.mockReset()
    mocks.adapter.pluginInfo.mockReset()
    mocks.adapter.pluginDoctor.mockReset()
    mocks.adapter.enablePlugin.mockReset()
    mocks.adapter.disablePlugin.mockReset()
    mocks.adapter.gatewayRestart.mockReset()
    mocks.adapter.installPlugin.mockReset()
    mocks.adapter.installPlugin.mockImplementation(async function* installPluginGenerator() {
      yield 'installed'
    })

    mocks.getOpenClawCapabilities.mockResolvedValue({
      available: true,
      version: '2026.2.17',
      resolvedBin: 'openclaw',
      plugins: {
        supported: true,
        listJson: true,
        infoJson: false,
        doctor: true,
        install: true,
        enable: true,
        disable: true,
        uninstall: true,
        setConfig: false,
      },
      sources: { cli: true, http: false },
      probedAt: new Date('2026-02-18T00:00:00.000Z'),
    })
  })

  it('uninstall uses runDynamicCommand and succeeds on exit code 0', async () => {
    mocks.runDynamicCommand.mockResolvedValue({
      exitCode: 0,
      durationMs: 8,
      stdout: 'Uninstalled plugin "plugin-alpha".\n',
      stderr: '',
      timedOut: false,
    })

    const { createCliPluginsRepo } = await import('../lib/repo/plugins')
    const repo = createCliPluginsRepo()
    const result = await repo.uninstall('plugin-alpha')

    expect(result.success).toBe(true)
    expect(result.meta.degraded).toBe(false)
    expect(mocks.runDynamicCommand).toHaveBeenCalledWith(
      'plugins.uninstall',
      { id: 'plugin-alpha' }
    )
  })

  it('uninstall returns degraded metadata on non-zero exit', async () => {
    mocks.runDynamicCommand.mockResolvedValue({
      exitCode: 1,
      durationMs: 7,
      stdout: '',
      stderr: 'uninstall failed',
      timedOut: false,
      error: 'uninstall failed',
    })

    const { createCliPluginsRepo } = await import('../lib/repo/plugins')
    const repo = createCliPluginsRepo()
    const result = await repo.uninstall('plugin-alpha')

    expect(result.success).toBe(false)
    expect(result.meta.degraded).toBe(true)
    expect(result.meta.message).toContain('uninstall failed')
  })

  it('getById is still available when infoJson capability is false', async () => {
    mocks.adapter.listPlugins.mockResolvedValue([
      {
        id: 'plugin-alpha',
        name: 'Plugin Alpha',
        enabled: true,
        status: 'ok',
        version: '1.0.0',
      },
    ])

    const { createCliPluginsRepo } = await import('../lib/repo/plugins')
    const repo = createCliPluginsRepo()
    const result = await repo.getById('plugin-alpha')

    expect(result.data?.id).toBe('plugin-alpha')
    expect(result.meta.source).toBe('openclaw_cli')
  })
})
