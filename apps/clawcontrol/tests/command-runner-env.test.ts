import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  let lastSpawnOptions: Record<string, unknown> | null = null

  const spawn = vi.fn((_bin: string, _args: string[], options: Record<string, unknown> = {}) => {
    lastSpawnOptions = options
    const child = {
      stdout: Readable.from(['{"ok":true}\n']),
      stderr: Readable.from([]),
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
    getLastSpawnOptions: () => lastSpawnOptions,
    reset: () => {
      spawn.mockReset()
      lastSpawnOptions = null
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

describe('command-runner env sanitization', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.reset()
  })

  it('removes inherited gateway token env vars', async () => {
    process.env.OPENCLAW_GATEWAY_TOKEN = 'stale-openclaw-token'
    process.env.CLAWDBOT_GATEWAY_TOKEN = 'stale-clawdbot-token'

    const mod = await import('../../../packages/adapters-openclaw/src/command-runner')
    const result = await mod.runCommandJson<{ ok: boolean }>('health.json')

    expect(result.exitCode).toBe(0)
    expect(result.data?.ok).toBe(true)

    const env = (mocks.getLastSpawnOptions()?.env ?? {}) as Record<string, unknown>
    expect(env.OPENCLAW_GATEWAY_TOKEN).toBeUndefined()
    expect(env.CLAWDBOT_GATEWAY_TOKEN).toBeUndefined()
  })

  it('keeps explicit gateway token overrides when provided by caller', async () => {
    process.env.OPENCLAW_GATEWAY_TOKEN = 'stale-openclaw-token'

    const mod = await import('../../../packages/adapters-openclaw/src/command-runner')
    const result = await mod.runCommandJson<{ ok: boolean }>('health.json', {
      env: {
        OPENCLAW_GATEWAY_TOKEN: 'explicit-token',
        CUSTOM_FLAG: '1',
      },
    })

    expect(result.exitCode).toBe(0)
    expect(result.data?.ok).toBe(true)

    const env = (mocks.getLastSpawnOptions()?.env ?? {}) as Record<string, unknown>
    expect(env.OPENCLAW_GATEWAY_TOKEN).toBe('explicit-token')
    expect(env.CUSTOM_FLAG).toBe('1')
  })
})
