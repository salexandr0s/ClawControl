import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFsSkillsRepo } from '@/lib/repo/skills'
import { invalidateWorkspaceRootCache } from '@/lib/fs/path-policy'

const originalOpenClawWorkspace = process.env.OPENCLAW_WORKSPACE
const originalClawcontrolWorkspaceRoot = process.env.CLAWCONTROL_WORKSPACE_ROOT
const originalWorkspaceRoot = process.env.WORKSPACE_ROOT
const originalSettingsPath = process.env.CLAWCONTROL_SETTINGS_PATH

let workspaceRoot = ''

function restoreEnv(key: 'OPENCLAW_WORKSPACE' | 'CLAWCONTROL_WORKSPACE_ROOT' | 'WORKSPACE_ROOT' | 'CLAWCONTROL_SETTINGS_PATH', value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'skills-case-test-'))
  await mkdir(join(workspaceRoot, 'skills', 'upper'), { recursive: true })
  await mkdir(join(workspaceRoot, 'skills', 'lower'), { recursive: true })
  await writeFile(join(workspaceRoot, 'AGENTS.md'), '# test\n', 'utf8')
  await writeFile(join(workspaceRoot, 'skills', 'upper', 'SKILL.md'), '# Upper\n\nupper', 'utf8')
  await writeFile(join(workspaceRoot, 'skills', 'lower', 'skill.md'), '# Lower\n\nlower', 'utf8')
  await writeFile(
    join(workspaceRoot, 'settings.json'),
    JSON.stringify({ workspacePath: workspaceRoot, updatedAt: new Date().toISOString() }),
    'utf8'
  )

  process.env.OPENCLAW_WORKSPACE = workspaceRoot
  process.env.CLAWCONTROL_SETTINGS_PATH = join(workspaceRoot, 'settings.json')
  delete process.env.CLAWCONTROL_WORKSPACE_ROOT
  delete process.env.WORKSPACE_ROOT
  invalidateWorkspaceRootCache()
})

afterEach(async () => {
  restoreEnv('OPENCLAW_WORKSPACE', originalOpenClawWorkspace)
  restoreEnv('CLAWCONTROL_WORKSPACE_ROOT', originalClawcontrolWorkspaceRoot)
  restoreEnv('WORKSPACE_ROOT', originalWorkspaceRoot)
  restoreEnv('CLAWCONTROL_SETTINGS_PATH', originalSettingsPath)
  invalidateWorkspaceRootCache()
  if (workspaceRoot) {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

describe('skills repo skill.md filename handling', () => {
  it('lists and reads skills whether markdown filename is SKILL.md or skill.md', async () => {
    const repo = createFsSkillsRepo()

    const listed = await repo.list({ scope: 'global' })
    const names = listed.map((skill) => skill.name).sort()
    expect(names).toEqual(['lower', 'upper'])

    const upper = await repo.getByName('global', 'upper')
    const lower = await repo.getByName('global', 'lower')

    expect(upper?.skillMd).toContain('upper')
    expect(lower?.skillMd).toContain('lower')
  })

  it('updates a skill that originally used SKILL.md', async () => {
    const repo = createFsSkillsRepo()
    const upper = await repo.getByName('global', 'upper')
    expect(upper).not.toBeNull()

    await repo.update('global', upper!.id, {
      skillMd: '# Upper Updated\n\nchanged',
    })

    const updated = await repo.getByName('global', 'upper')
    expect(updated?.skillMd).toContain('Upper Updated')
  })
})
