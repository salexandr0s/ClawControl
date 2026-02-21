import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface SpawnPlan {
  exitCode?: number
  error?: boolean
  stdout?: string
}

const mocks = vi.hoisted(() => {
  const state = {
    homeDir: '/Users/tester',
    existingPaths: new Set<string>(),
    spawnPlans: new Map<string, SpawnPlan>(),
    spawnBins: [] as string[],
  }

  const reset = () => {
    state.homeDir = '/Users/tester'
    state.existingPaths.clear()
    state.spawnPlans.clear()
    state.spawnBins = []
  }

  const spawn = vi.fn((bin: string) => {
    state.spawnBins.push(bin)
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
    }

    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()

    queueMicrotask(() => {
      const plan = state.spawnPlans.get(bin) ?? { exitCode: 1 }
      if (plan.error) {
        child.emit('error', new Error('spawn ENOENT'))
        return
      }
      if (plan.stdout) {
        child.stdout.emit('data', Buffer.from(plan.stdout))
      }
      child.emit('close', plan.exitCode ?? 0)
    })

    return child
  })

  return {
    state,
    reset,
    spawn,
  }
})

vi.mock('os', () => ({
  homedir: () => mocks.state.homeDir,
}))

vi.mock('fs', () => ({
  existsSync: (value: unknown) => mocks.state.existingPaths.has(String(value)),
}))

vi.mock('child_process', () => ({
  spawn: mocks.spawn,
}))

describe('openclaw resolve-bin pnpm resolution', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.reset()
    delete process.env.PNPM_HOME
    delete process.env.OPENCLAW_BIN
  })

  it('uses PNPM_HOME/openclaw when the default PATH command is unavailable', async () => {
    process.env.PNPM_HOME = '/custom/pnpm'
    mocks.state.existingPaths.add('/custom/pnpm/openclaw')
    mocks.state.spawnPlans.set('openclaw', { error: true })
    mocks.state.spawnPlans.set('/custom/pnpm/openclaw', {
      exitCode: 0,
      stdout: 'openclaw 2026.2.20\n',
    })

    const mod = await import('../../../packages/adapters-openclaw/src/resolve-bin')
    const check = await mod.checkOpenClaw()

    expect(check.available).toBe(true)
    expect(mod.getOpenClawBin()).toBe('/custom/pnpm/openclaw')
    expect(mocks.state.spawnBins).toContain('/custom/pnpm/openclaw')
  })

  it('falls back to the default macOS pnpm bin path when PNPM_HOME is unset', async () => {
    const pnpmDefaultPath = '/Users/tester/Library/pnpm/openclaw'
    mocks.state.existingPaths.add(pnpmDefaultPath)
    mocks.state.spawnPlans.set('openclaw', { error: true })
    mocks.state.spawnPlans.set(pnpmDefaultPath, {
      exitCode: 0,
      stdout: 'openclaw 2026.2.21\n',
    })

    const mod = await import('../../../packages/adapters-openclaw/src/resolve-bin')
    const check = await mod.checkOpenClaw()

    expect(check.available).toBe(true)
    expect(mod.getOpenClawBin()).toBe(pnpmDefaultPath)
    expect(mocks.state.spawnBins).toContain(pnpmDefaultPath)
  })
})
