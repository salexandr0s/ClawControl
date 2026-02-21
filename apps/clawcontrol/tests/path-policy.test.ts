import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { promises as fsp } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

describe('workspace path policy', () => {
  const originalCwd = process.cwd()
  const originalHome = process.env.HOME
  const originalWorkspace = process.env.OPENCLAW_WORKSPACE
  const originalClawcontrolWorkspaceRoot = process.env.CLAWCONTROL_WORKSPACE_ROOT
  const originalWorkspaceRoot = process.env.WORKSPACE_ROOT
  const originalAllowlistOnly = process.env.CLAWCONTROL_WORKSPACE_ALLOWLIST_ONLY

  let tempRoot = ''
  let fakeHome = ''

  function restoreEnv(key: string, value: string | undefined): void {
    if (value === undefined) {
      delete process.env[key]
      return
    }
    process.env[key] = value
  }

  beforeEach(async () => {
    tempRoot = join(tmpdir(), `path-policy-test-${randomUUID()}`)
    await fsp.mkdir(tempRoot, { recursive: true })
    fakeHome = join(tempRoot, 'home')
    await fsp.mkdir(fakeHome, { recursive: true })
    process.env.HOME = fakeHome
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    restoreEnv('HOME', originalHome)
    restoreEnv('OPENCLAW_WORKSPACE', originalWorkspace)
    restoreEnv('CLAWCONTROL_WORKSPACE_ROOT', originalClawcontrolWorkspaceRoot)
    restoreEnv('WORKSPACE_ROOT', originalWorkspaceRoot)
    restoreEnv('CLAWCONTROL_WORKSPACE_ALLOWLIST_ONLY', originalAllowlistOnly)
    vi.resetModules()

    if (tempRoot) {
      await fsp.rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('defaults to ~/openclaw and does not infer workspace root from cwd', async () => {
    const repoLikeRoot = join(tempRoot, 'repo')
    const nested = join(repoLikeRoot, 'apps', 'clawcontrol')

    await fsp.mkdir(nested, { recursive: true })
    await fsp.writeFile(join(repoLikeRoot, 'AGENTS.md'), '# test')

    delete process.env.OPENCLAW_WORKSPACE
    delete process.env.CLAWCONTROL_WORKSPACE_ROOT
    delete process.env.WORKSPACE_ROOT
    process.chdir(nested)
    vi.resetModules()

    const mod = await import('@/lib/fs/path-policy')
    expect(mod.getWorkspaceRoot()).toBe(resolve(fakeHome, 'openclaw'))
  })

  it('prefers ~/.openclaw/openclaw.json workspace when env vars are unset', async () => {
    const configDir = join(fakeHome, '.openclaw')
    const configuredWorkspace = join(tempRoot, 'openclaw-workspace')

    await fsp.mkdir(configDir, { recursive: true })
    await fsp.mkdir(configuredWorkspace, { recursive: true })
    await fsp.writeFile(join(configuredWorkspace, 'AGENTS.md'), '# test')
    await fsp.writeFile(
      join(configDir, 'openclaw.json'),
      JSON.stringify({
        agents: {
          defaults: {
            workspace: configuredWorkspace,
          },
        },
      }, null, 2)
    )

    delete process.env.OPENCLAW_WORKSPACE
    delete process.env.CLAWCONTROL_WORKSPACE_ROOT
    delete process.env.WORKSPACE_ROOT
    vi.resetModules()

    const mod = await import('@/lib/fs/path-policy')
    expect(await fsp.realpath(mod.getWorkspaceRoot())).toBe(await fsp.realpath(configuredWorkspace))
  })

  it('reads workspace from legacy config directories and filenames', async () => {
    const legacyDir = join(fakeHome, '.moltbot')
    const legacyWorkspace = join(tempRoot, 'legacy-workspace')

    await fsp.mkdir(legacyDir, { recursive: true })
    await fsp.mkdir(legacyWorkspace, { recursive: true })
    await fsp.writeFile(join(legacyWorkspace, 'AGENTS.md'), '# test')
    await fsp.writeFile(
      join(legacyDir, 'moltbot.json'),
      JSON.stringify({
        workspace: legacyWorkspace,
      }, null, 2)
    )

    delete process.env.OPENCLAW_WORKSPACE
    delete process.env.CLAWCONTROL_WORKSPACE_ROOT
    delete process.env.WORKSPACE_ROOT
    vi.resetModules()

    const mod = await import('@/lib/fs/path-policy')
    expect(await fsp.realpath(mod.getWorkspaceRoot())).toBe(await fsp.realpath(legacyWorkspace))
  })

  it('reads workspace from uppercase .OpenClaw config directory alias', async () => {
    const lowerDir = join(fakeHome, '.openclaw')
    const upperDir = join(fakeHome, '.OpenClaw')
    const upperWorkspace = join(tempRoot, 'upper-workspace')

    await fsp.mkdir(lowerDir, { recursive: true })
    await fsp.mkdir(upperDir, { recursive: true })
    await fsp.mkdir(upperWorkspace, { recursive: true })
    await fsp.writeFile(join(upperWorkspace, 'AGENTS.md'), '# test')
    await fsp.writeFile(
      join(upperDir, 'openclaw.json'),
      JSON.stringify({
        workspace: upperWorkspace,
      }, null, 2)
    )

    delete process.env.OPENCLAW_WORKSPACE
    delete process.env.CLAWCONTROL_WORKSPACE_ROOT
    delete process.env.WORKSPACE_ROOT
    vi.resetModules()

    const mod = await import('@/lib/fs/path-policy')
    expect(await fsp.realpath(mod.getWorkspaceRoot())).toBe(await fsp.realpath(upperWorkspace))
  })

  it('prefers OPENCLAW_WORKSPACE over ~/.openclaw/openclaw.json workspace', async () => {
    const configDir = join(fakeHome, '.openclaw')
    const configuredWorkspace = join(tempRoot, 'openclaw-workspace')
    const envWorkspace = join(tempRoot, 'env-workspace')

    await fsp.mkdir(configDir, { recursive: true })
    await fsp.mkdir(configuredWorkspace, { recursive: true })
    await fsp.mkdir(envWorkspace, { recursive: true })
    await fsp.writeFile(join(configDir, 'openclaw.json'), JSON.stringify({
      agents: {
        defaults: {
          workspace: configuredWorkspace,
        },
      },
    }, null, 2))

    process.env.OPENCLAW_WORKSPACE = envWorkspace
    delete process.env.CLAWCONTROL_WORKSPACE_ROOT
    delete process.env.WORKSPACE_ROOT
    vi.resetModules()

    const mod = await import('@/lib/fs/path-policy')
    expect(await fsp.realpath(mod.getWorkspaceRoot())).toBe(await fsp.realpath(envWorkspace))
  })

  it('prefers settings workspace over OPENCLAW_WORKSPACE', async () => {
    const settingsWorkspace = join(tempRoot, 'settings-workspace')
    const envWorkspace = join(tempRoot, 'env-workspace')
    const settingsDir = join(fakeHome, '.openclaw', 'clawcontrol')

    await fsp.mkdir(settingsWorkspace, { recursive: true })
    await fsp.mkdir(envWorkspace, { recursive: true })
    await fsp.mkdir(settingsDir, { recursive: true })
    await fsp.writeFile(
      join(settingsDir, 'settings.json'),
      JSON.stringify({ workspacePath: settingsWorkspace, updatedAt: new Date().toISOString() })
    )

    process.env.OPENCLAW_WORKSPACE = envWorkspace
    vi.resetModules()

    const mod = await import('@/lib/fs/path-policy')
    expect(await fsp.realpath(mod.getWorkspaceRoot())).toBe(await fsp.realpath(settingsWorkspace))
  })

  it('honors runtime workspace updates after cache invalidation', async () => {
    const settingsWorkspaceA = join(tempRoot, 'settings-workspace-a')
    const settingsWorkspaceB = join(tempRoot, 'settings-workspace-b')
    const settingsDir = join(fakeHome, '.openclaw', 'clawcontrol')
    const settingsPath = join(settingsDir, 'settings.json')

    await fsp.mkdir(settingsWorkspaceA, { recursive: true })
    await fsp.mkdir(settingsWorkspaceB, { recursive: true })
    await fsp.mkdir(settingsDir, { recursive: true })
    await fsp.writeFile(settingsPath, JSON.stringify({
      workspacePath: settingsWorkspaceA,
      updatedAt: new Date().toISOString(),
    }))

    vi.resetModules()

    const mod = await import('@/lib/fs/path-policy')
    expect(await fsp.realpath(mod.getWorkspaceRoot())).toBe(await fsp.realpath(settingsWorkspaceA))

    await fsp.writeFile(settingsPath, JSON.stringify({
      workspacePath: settingsWorkspaceB,
      updatedAt: new Date().toISOString(),
    }))
    mod.invalidateWorkspaceRootCache()

    expect(await fsp.realpath(mod.getWorkspaceRoot())).toBe(await fsp.realpath(settingsWorkspaceB))

    const validated = mod.validateWorkspacePath('/agents')
    expect(validated.valid).toBe(true)
    expect(validated.resolvedPath).toBe(join(settingsWorkspaceB, 'agents'))
  })

  it('allows non-allowlisted top-level directories in default mode', async () => {
    await fsp.mkdir(join(tempRoot, 'my-custom-dir'), { recursive: true })
    await fsp.writeFile(join(tempRoot, 'AGENTS.md'), '# test')

    process.env.OPENCLAW_WORKSPACE = tempRoot
    delete process.env.CLAWCONTROL_WORKSPACE_ALLOWLIST_ONLY
    vi.resetModules()

    const { validateWorkspacePath } = await import('@/lib/fs/path-policy')
    const { listWorkspace } = await import('@/lib/fs/workspace-fs')

    const check = validateWorkspacePath('/my-custom-dir')
    expect(check.valid).toBe(true)

    const rows = await listWorkspace('/')
    expect(rows.some((row) => row.name === 'my-custom-dir')).toBe(true)
  })

  it('keeps strict root allowlist behavior when explicitly enabled', async () => {
    await fsp.mkdir(join(tempRoot, 'my-custom-dir'), { recursive: true })
    await fsp.mkdir(join(tempRoot, 'memory'), { recursive: true })
    await fsp.writeFile(join(tempRoot, 'AGENTS.md'), '# test')

    process.env.OPENCLAW_WORKSPACE = tempRoot
    process.env.CLAWCONTROL_WORKSPACE_ALLOWLIST_ONLY = '1'
    vi.resetModules()

    const { validateWorkspacePath } = await import('@/lib/fs/path-policy')
    const { listWorkspace } = await import('@/lib/fs/workspace-fs')

    const denied = validateWorkspacePath('/my-custom-dir')
    expect(denied.valid).toBe(false)

    const allowed = validateWorkspacePath('/memory')
    expect(allowed.valid).toBe(true)

    const rows = await listWorkspace('/')
    expect(rows.some((row) => row.name === 'my-custom-dir')).toBe(false)
    expect(rows.some((row) => row.name === 'memory')).toBe(true)
  })

  it('falls back to historical workspace directory names with lowercase openclaw preference', async () => {
    const openClawWorkspace = join(fakeHome, 'openclaw')
    const upperAlias = join(fakeHome, 'OpenClaw')
    const legacyAlias = join(fakeHome, 'clawd')

    await fsp.mkdir(openClawWorkspace, { recursive: true })
    await fsp.writeFile(join(openClawWorkspace, 'AGENTS.md'), '# test')

    try {
      await fsp.symlink(openClawWorkspace, upperAlias)
    } catch {
      // Ignore environments where symlink creation is restricted.
    }

    try {
      await fsp.symlink(openClawWorkspace, legacyAlias)
    } catch {
      // Ignore environments where symlink creation is restricted.
    }

    delete process.env.OPENCLAW_WORKSPACE
    delete process.env.CLAWCONTROL_WORKSPACE_ROOT
    delete process.env.WORKSPACE_ROOT
    vi.resetModules()

    const mod = await import('@/lib/fs/path-policy')
    expect(await fsp.realpath(mod.getWorkspaceRoot())).toBe(await fsp.realpath(openClawWorkspace))
  })

  it('uses separator-safe containment checks', async () => {
    const mod = await import('@/lib/fs/path-policy')

    expect(mod.isPathWithinRoot('/tmp/workspace/docs/file.md', '/tmp/workspace')).toBe(true)
    expect(mod.isPathWithinRoot('/tmp/workspace-archive/file.md', '/tmp/workspace')).toBe(false)
  })
})
