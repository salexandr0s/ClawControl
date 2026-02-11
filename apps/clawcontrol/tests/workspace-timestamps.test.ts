import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

describe('workspace timestamps', () => {
  const originalWorkspace = process.env.OPENCLAW_WORKSPACE
  const originalSettingsPath = process.env.CLAWCONTROL_SETTINGS_PATH
  const originalClawcontrolWorkspaceRoot = process.env.CLAWCONTROL_WORKSPACE_ROOT
  const originalWorkspaceRoot = process.env.WORKSPACE_ROOT
  let workspaceRoot = ''

  beforeEach(async () => {
    workspaceRoot = join(tmpdir(), `workspace-test-${randomUUID()}`)
    await fsp.mkdir(join(workspaceRoot, 'memory'), { recursive: true })
    workspaceRoot = await fsp.realpath(workspaceRoot)
    await fsp.mkdir(join(workspaceRoot, 'memory'), { recursive: true })
    await fsp.writeFile(join(workspaceRoot, 'AGENTS.md'), '# test')
    await fsp.writeFile(join(workspaceRoot, 'memory', 'entry.md'), 'hello')

    process.env.OPENCLAW_WORKSPACE = workspaceRoot
    process.env.CLAWCONTROL_SETTINGS_PATH = join(workspaceRoot, 'settings.json')
    delete process.env.CLAWCONTROL_WORKSPACE_ROOT
    delete process.env.WORKSPACE_ROOT
    vi.resetModules()
  })

  afterEach(() => {
    process.env.OPENCLAW_WORKSPACE = originalWorkspace
    process.env.CLAWCONTROL_SETTINGS_PATH = originalSettingsPath
    process.env.CLAWCONTROL_WORKSPACE_ROOT = originalClawcontrolWorkspaceRoot
    process.env.WORKSPACE_ROOT = originalWorkspaceRoot
  })

  it('maps createdAt/lastEditedAt fields on workspace entries', async () => {
    const { listWorkspace } = await import('@/lib/fs/workspace-fs')
    const rows = await listWorkspace('/memory')

    expect(rows.length).toBe(1)
    expect(rows[0]?.lastEditedAt).toBeInstanceOf(Date)
    expect(Object.prototype.hasOwnProperty.call(rows[0] ?? {}, 'createdAt')).toBe(true)
  })

  it('returns null for unreliable createdAt values', async () => {
    const { reliableCreatedAtFromStat } = await import('@/lib/fs/workspace-fs')
    const invalid = reliableCreatedAtFromStat({ birthtime: new Date('3000-01-01T00:00:00.000Z') })
    expect(invalid).toBeNull()
  })

  it('skips broken entries while listing a directory', async () => {
    const skillsDir = join(workspaceRoot, 'skills')
    await fsp.mkdir(join(skillsDir, 'valid-skill'), { recursive: true })
    await fsp.writeFile(join(skillsDir, 'valid-skill', 'SKILL.md'), '# Valid\n', 'utf8')

    // Broken symlink previously caused listWorkspace() to throw and upstream skills list to appear empty.
    try {
      await fsp.symlink(join(skillsDir, 'missing-target'), join(skillsDir, 'broken-link'))
    } catch {
      // Ignore environments where creating symlinks is restricted.
    }

    const { listWorkspace } = await import('@/lib/fs/workspace-fs')
    const rows = await listWorkspace('/skills')
    const names = rows.map((row) => row.name)

    expect(names).toContain('valid-skill')
  })
})
