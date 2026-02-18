import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  type SpawnCall = { bin: string; args: string[]; options: Record<string, unknown> }
  const calls: SpawnCall[] = []

  const spawn = vi.fn((bin: string, args: string[], options: Record<string, unknown> = {}) => {
    calls.push({ bin, args: [...args], options })
    const child = {
      stdout: Readable.from(['{"ok":true}\n']),
      stderr: Readable.from([]),
      stdin: {
        write: vi.fn(),
        end: vi.fn(),
      },
      on(event: string, cb: (...args: unknown[]) => void) {
        if (event === 'close') {
          setTimeout(() => cb(0), 0)
        }
        return this
      },
    }
    return child as unknown
  })

  return {
    spawn,
    getCalls: () => calls,
    reset: () => {
      spawn.mockReset()
      calls.splice(0, calls.length)
    },
  }
})

vi.mock('child_process', () => ({
  spawn: mocks.spawn,
}))

vi.mock('../../../packages/adapters-openclaw/src/resolve-bin', () => ({
  checkOpenClaw: vi.fn(async () => ({ available: true })),
  getOpenClawBin: vi.fn(() => 'openclaw'),
}))

describe('command-runner dynamic arg construction (OpenClaw 2.17+)', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.reset()
  })

  it('builds positional cron command args without legacy --json/--id flags', async () => {
    const mod = await import('../../../packages/adapters-openclaw/src/command-runner')

    await mod.runDynamicCommand('cron.run', { id: 'job_1' })
    await mod.runDynamicCommand('cron.enable', { id: 'job_1' })
    await mod.runDynamicCommand('cron.disable', { id: 'job_1' })
    await mod.runDynamicCommand('cron.edit.every', { id: 'job_1', every: '20m' })
    await mod.runDynamicCommand('cron.edit.cron', {
      id: 'job_1',
      cron: '0 * * * *',
      tz: 'UTC',
      stagger: '20s',
      exact: 'true',
    })
    await mod.runDynamicCommand('cron.edit.at', { id: 'job_1', at: '+20m' })
    await mod.runDynamicCommand('cron.delete', { id: 'job_1' })

    const argsByCommand = mocks.getCalls().map((call) => call.args)

    expect(argsByCommand[0]).toEqual(['cron', 'run', 'job_1'])
    expect(argsByCommand[1]).toEqual(['cron', 'enable', 'job_1'])
    expect(argsByCommand[2]).toEqual(['cron', 'disable', 'job_1'])
    expect(argsByCommand[3]).toEqual(['cron', 'edit', 'job_1', '--every', '20m'])
    expect(argsByCommand[4]).toEqual([
      'cron',
      'edit',
      'job_1',
      '--cron',
      '0 * * * *',
      '--tz',
      'UTC',
      '--stagger',
      '20s',
      '--exact',
    ])
    expect(argsByCommand[5]).toEqual(['cron', 'edit', 'job_1', '--at', '+20m'])
    expect(argsByCommand[6]).toEqual(['cron', 'delete', '--json', 'job_1'])
  })

  it('builds cron.runs with required --id and optional --limit', async () => {
    const mod = await import('../../../packages/adapters-openclaw/src/command-runner')

    await mod.runDynamicCommand('cron.runs', { id: 'job_1', limit: '25' })

    const args = mocks.getCalls()[0]?.args
    expect(args).toEqual(['cron', 'runs', '--id', 'job_1', '--limit', '25'])
  })

  it('builds cron.create with 2.17+ schedule/payload/delivery flags', async () => {
    const mod = await import('../../../packages/adapters-openclaw/src/command-runner')

    await mod.runDynamicCommand('cron.create', {
      name: 'nightly-summary',
      session: 'isolated',
      wake: 'now',
      cron: '0 8 * * *',
      tz: 'UTC',
      stagger: '20s',
      exact: 'true',
      message: 'Summarize overnight changes',
      announce: 'true',
      channel: 'telegram',
      to: '5315323298',
      'best-effort-deliver': 'true',
      disabled: 'true',
    })

    const args = mocks.getCalls()[0]?.args
    expect(args).toEqual([
      'cron',
      'add',
      '--json',
      '--name',
      'nightly-summary',
      '--session',
      'isolated',
      '--wake',
      'now',
      '--disabled',
      '--cron',
      '0 8 * * *',
      '--tz',
      'UTC',
      '--stagger',
      '20s',
      '--exact',
      '--message',
      'Summarize overnight changes',
      '--announce',
      '--channel',
      'telegram',
      '--to',
      '5315323298',
      '--best-effort-deliver',
    ])
  })

  it('builds plugin commands with positional IDs/spec and no legacy --json flags', async () => {
    const mod = await import('../../../packages/adapters-openclaw/src/command-runner')

    await mod.runDynamicCommand('plugins.enable', { id: 'plugin-alpha' })
    await mod.runDynamicCommand('plugins.disable', { id: 'plugin-alpha' })
    await mod.runDynamicCommand('plugins.uninstall', { id: 'plugin-alpha' })
    await mod.runDynamicCommand('plugins.install', { spec: '@openclaw/plugin-alpha' })

    const argsByCommand = mocks.getCalls().map((call) => call.args)
    expect(argsByCommand[0]).toEqual(['plugins', 'enable', 'plugin-alpha'])
    expect(argsByCommand[1]).toEqual(['plugins', 'disable', 'plugin-alpha'])
    expect(argsByCommand[2]).toEqual(['plugins', 'uninstall', 'plugin-alpha'])
    expect(argsByCommand[3]).toEqual(['plugins', 'install', '@openclaw/plugin-alpha'])
  })
})
