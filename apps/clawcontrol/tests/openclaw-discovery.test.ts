import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

describe('OpenClaw discovery', () => {
  const originalHome = process.env.HOME

  let tempRoot = ''
  let fakeHome = ''
  let openClawDir = ''

  beforeEach(async () => {
    tempRoot = join(tmpdir(), `openclaw-discovery-${randomUUID()}`)
    fakeHome = join(tempRoot, 'home')
    openClawDir = join(fakeHome, '.openclaw')

    await fsp.mkdir(openClawDir, { recursive: true })
    process.env.HOME = fakeHome
    vi.resetModules()
  })

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome

    vi.resetModules()
    await fsp.rm(tempRoot, { recursive: true, force: true })
  })

  it('prefers openclaw.json over config.yaml while merging filesystem agents', async () => {
    await fsp.writeFile(
      join(openClawDir, 'openclaw.json'),
      JSON.stringify({
        remote: {
          url: 'http://127.0.0.1:19999',
          token: 'json-token',
        },
        workspace: '/json/workspace',
        agents: {
          list: [
            { id: 'json-agent', name: 'JSON Agent' },
          ],
        },
      })
    )

    await fsp.writeFile(
      join(openClawDir, 'config.yaml'),
      [
        'remote:',
        '  url: http://127.0.0.1:18888',
        '  token: yaml-token',
        'workspace: /yaml/workspace',
        'agents:',
        '  list:',
        '    - id: yaml-agent',
      ].join('\n')
    )

    await fsp.mkdir(join(openClawDir, 'agents', 'fs-agent', 'agent'), { recursive: true })

    const mod = await import('../../../packages/adapters-openclaw/src/discovery')
    const discovered = await mod.discoverLocalConfig()

    expect(discovered).not.toBeNull()
    expect(discovered?.gatewayUrl).toBe('http://127.0.0.1:19999')
    expect(discovered?.token).toBe('json-token')
    expect(discovered?.workspacePath).toBe('/json/workspace')

    const agentIds = (discovered?.agents ?? []).map((agent) => agent.id).sort()
    expect(agentIds).toEqual(['fs-agent', 'json-agent', 'yaml-agent'])
  })

  it('falls back to config.yaml and reads remote.token', async () => {
    await fsp.writeFile(
      join(openClawDir, 'config.yaml'),
      [
        'remote:',
        '  url: http://127.0.0.1:17777',
        '  token: yaml-remote-token',
        'workspace: /yaml/workspace',
      ].join('\n')
    )

    const mod = await import('../../../packages/adapters-openclaw/src/discovery')
    const discovered = await mod.discoverLocalConfig()

    expect(discovered).not.toBeNull()
    expect(discovered?.gatewayUrl).toBe('http://127.0.0.1:17777')
    expect(discovered?.token).toBe('yaml-remote-token')
    expect(discovered?.workspacePath).toBe('/yaml/workspace')
    expect(discovered?.source).toBe('config.yaml')
  })

  it('supports legacy config directories and filenames', async () => {
    const legacyDir = join(fakeHome, '.moltbot')
    await fsp.mkdir(legacyDir, { recursive: true })
    await fsp.writeFile(
      join(legacyDir, 'moltbot.json'),
      JSON.stringify({
        remote: {
          url: 'http://127.0.0.1:16666',
          token: 'legacy-token',
        },
        workspace: '/legacy/workspace',
      })
    )

    const mod = await import('../../../packages/adapters-openclaw/src/discovery')
    const discovered = await mod.discoverLocalConfig()

    expect(discovered).not.toBeNull()
    expect(discovered?.gatewayUrl).toBe('http://127.0.0.1:16666')
    expect(discovered?.token).toBe('legacy-token')
    expect(discovered?.workspacePath).toBe('/legacy/workspace')
    expect(discovered?.source).toBe('moltbot.json')
  })

  it('supports uppercase .OpenClaw config directory alias', async () => {
    const upperConfigDir = join(fakeHome, '.OpenClaw')
    await fsp.mkdir(upperConfigDir, { recursive: true })
    await fsp.writeFile(
      join(upperConfigDir, 'openclaw.json'),
      JSON.stringify({
        remote: {
          url: 'http://127.0.0.1:14444',
          token: 'upper-token',
        },
        workspace: '/upper/workspace',
      })
    )

    const mod = await import('../../../packages/adapters-openclaw/src/discovery')
    const discovered = await mod.discoverLocalConfig()

    expect(discovered).not.toBeNull()
    expect(discovered?.gatewayUrl).toBe('http://127.0.0.1:14444')
    expect(discovered?.token).toBe('upper-token')
    expect(discovered?.workspacePath).toBe('/upper/workspace')
    expect(discovered?.source).toBe('openclaw.json')
  })

  it('deduplicates symlinked config/workspace aliases and falls back to ~/openclaw', async () => {
    await fsp.writeFile(
      join(openClawDir, 'openclaw.json'),
      JSON.stringify({
        remote: {
          url: 'http://127.0.0.1:15555',
        },
        agents: {
          list: [
            { id: 'alpha' },
          ],
        },
      })
    )
    await fsp.mkdir(join(openClawDir, 'agents', 'alpha', 'agent'), { recursive: true })

    const openClawWorkspace = join(fakeHome, 'openclaw')
    const upperAlias = join(fakeHome, 'OpenClaw')
    const clawdAlias = join(fakeHome, 'clawd')
    await fsp.mkdir(openClawWorkspace, { recursive: true })

    try {
      await fsp.symlink(openClawDir, join(fakeHome, '.clawdbot'))
    } catch {
      // Ignore environments where symlink creation is restricted.
    }

    try {
      await fsp.symlink(openClawWorkspace, clawdAlias)
    } catch {
      // Ignore environments where symlink creation is restricted.
    }

    try {
      await fsp.symlink(openClawWorkspace, upperAlias)
    } catch {
      // Ignore environments where symlink creation is restricted.
    }

    const mod = await import('../../../packages/adapters-openclaw/src/discovery')
    const discovered = await mod.discoverLocalConfig()

    expect(discovered).not.toBeNull()
    expect(discovered?.workspacePath).toBe(await fsp.realpath(openClawWorkspace))

    const alphaCount = (discovered?.agents ?? []).filter((agent) => agent.id === 'alpha').length
    expect(alphaCount).toBe(1)
  })
})
