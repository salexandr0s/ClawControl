import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runCommand: vi.fn(),
  runCommandJson: vi.fn(),
  runDynamicCommand: vi.fn(),
  executeCommand: vi.fn(),
  checkOpenClawAvailable: vi.fn(),
}))

vi.mock('../../../packages/adapters-openclaw/src/command-runner', () => ({
  runCommand: mocks.runCommand,
  runCommandJson: mocks.runCommandJson,
  runDynamicCommand: mocks.runDynamicCommand,
  executeCommand: mocks.executeCommand,
  checkOpenClawAvailable: mocks.checkOpenClawAvailable,
}))

describe('LocalCliAdapter plugin operations (OpenClaw 2.17+)', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.runCommand.mockReset()
    mocks.runCommandJson.mockReset()
    mocks.runDynamicCommand.mockReset()
    mocks.executeCommand.mockReset()
    mocks.checkOpenClawAvailable.mockReset()
    mocks.checkOpenClawAvailable.mockResolvedValue({ available: true })
  })

  it('runs pluginDoctor via non-JSON plugins.doctor command', async () => {
    mocks.runCommand.mockResolvedValue({
      exitCode: 0,
      durationMs: 9,
      stdout: 'No plugin issues detected.\n',
      stderr: '',
      timedOut: false,
    })

    const { createAdapter } = await import('../../../packages/adapters-openclaw/src/adapter')
    const adapter = createAdapter({ mode: 'local_cli' })
    const result = await adapter.pluginDoctor()

    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
    expect(mocks.runCommand).toHaveBeenCalledWith('plugins.doctor')
  })

  it('installPlugin executes plugins.install dynamic command with provided spec', async () => {
    mocks.runDynamicCommand.mockResolvedValue({
      exitCode: 0,
      durationMs: 14,
      stdout: 'Installed plugin: plugin-alpha\n',
      stderr: '',
      timedOut: false,
    })

    const { createAdapter } = await import('../../../packages/adapters-openclaw/src/adapter')
    const adapter = createAdapter({ mode: 'local_cli' })

    const chunks: string[] = []
    for await (const chunk of adapter.installPlugin('@openclaw/plugin-alpha')) {
      chunks.push(chunk)
    }

    expect(chunks.join('')).toContain('Installed plugin')
    expect(mocks.runDynamicCommand).toHaveBeenCalledWith(
      'plugins.install',
      { spec: '@openclaw/plugin-alpha' }
    )
  })

  it('enable/disable call dynamic plugin commands and surface failures', async () => {
    mocks.runDynamicCommand
      .mockResolvedValueOnce({
        exitCode: 0,
        durationMs: 5,
        stdout: '',
        stderr: '',
        timedOut: false,
      })
      .mockResolvedValueOnce({
        exitCode: 1,
        durationMs: 5,
        stdout: '',
        stderr: 'disable failed',
        timedOut: false,
        error: 'disable failed',
      })

    const { createAdapter } = await import('../../../packages/adapters-openclaw/src/adapter')
    const adapter = createAdapter({ mode: 'local_cli' })

    await expect(adapter.enablePlugin('plugin-alpha')).resolves.toBeUndefined()
    await expect(adapter.disablePlugin('plugin-alpha')).rejects.toThrow('disable failed')

    expect(mocks.runDynamicCommand).toHaveBeenNthCalledWith(
      1,
      'plugins.enable',
      { id: 'plugin-alpha' }
    )
    expect(mocks.runDynamicCommand).toHaveBeenNthCalledWith(
      2,
      'plugins.disable',
      { id: 'plugin-alpha' }
    )
  })
})
