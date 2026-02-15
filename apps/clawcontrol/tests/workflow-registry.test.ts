import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import {
  clearWorkflowRegistryCache,
  getWorkflowConfig,
  getWorkflowRegistrySnapshot,
  listWorkflowConfigs,
} from '@/lib/workflows/registry'
import { invalidateWorkspaceRootCache } from '@/lib/fs/path-policy'

const originalOpenClawWorkspace = process.env.OPENCLAW_WORKSPACE
const originalSettingsPath = process.env.CLAWCONTROL_SETTINGS_PATH
const originalClawcontrolWorkspaceRoot = process.env.CLAWCONTROL_WORKSPACE_ROOT
const originalWorkspaceRoot = process.env.WORKSPACE_ROOT

let tempWorkspace = ''

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}

beforeEach(() => {
  tempWorkspace = join(tmpdir(), `workflow-registry-test-${randomUUID()}`)
  return fsp.mkdir(tempWorkspace, { recursive: true }).then(async () => {
    process.env.OPENCLAW_WORKSPACE = tempWorkspace
    process.env.CLAWCONTROL_SETTINGS_PATH = join(tempWorkspace, 'settings.json')
    delete process.env.CLAWCONTROL_WORKSPACE_ROOT
    delete process.env.WORKSPACE_ROOT
    await fsp.writeFile(
      process.env.CLAWCONTROL_SETTINGS_PATH,
      JSON.stringify({ workspacePath: tempWorkspace, updatedAt: new Date().toISOString() })
    )

    invalidateWorkspaceRootCache()
    clearWorkflowRegistryCache()
    vi.restoreAllMocks()
  })
})

afterEach(() => {
  restoreEnv('OPENCLAW_WORKSPACE', originalOpenClawWorkspace)
  restoreEnv('CLAWCONTROL_SETTINGS_PATH', originalSettingsPath)
  restoreEnv('CLAWCONTROL_WORKSPACE_ROOT', originalClawcontrolWorkspaceRoot)
  restoreEnv('WORKSPACE_ROOT', originalWorkspaceRoot)

  invalidateWorkspaceRootCache()
  clearWorkflowRegistryCache()

  const workspaceToRemove = tempWorkspace
  tempWorkspace = ''
  if (!workspaceToRemove) return
  return fsp.rm(workspaceToRemove, { recursive: true, force: true })
})

describe('workflow registry', () => {
  it('loads and validates all configured workflow YAML files', async () => {
    const workflows = await listWorkflowConfigs()
    const ids = workflows.map((workflow) => workflow.id)

    expect(ids).toEqual([
      'bug_fix',
      'content_creation',
      'greenfield_project',
      'ops_change',
      'security_audit',
    ])
  })

  it('returns workflow details by id', async () => {
    const workflow = await getWorkflowConfig('greenfield_project')

    expect(workflow).not.toBeNull()
    expect(workflow?.stages.length).toBeGreaterThan(0)
    expect(workflow?.stages.some((stage) => stage.type === 'loop')).toBe(true)
  })

  it('returns selection configuration in snapshot', async () => {
    const snapshot = await getWorkflowRegistrySnapshot()

    expect(snapshot.selection.defaultWorkflowId).toBe('greenfield_project')
    expect(snapshot.selection.rules.length).toBeGreaterThan(0)
    expect(snapshot.loadedAt).toContain('T')
  })
})
