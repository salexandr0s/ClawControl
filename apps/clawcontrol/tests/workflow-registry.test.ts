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

async function writeWorkflowFile(workspaceRoot: string, fileName: string, yamlBody: string): Promise<void> {
  const workflowsDir = join(workspaceRoot, 'workflows')
  await fsp.mkdir(workflowsDir, { recursive: true })
  await fsp.writeFile(join(workflowsDir, fileName), `${yamlBody.trim()}\n`, 'utf8')
}

async function seedWorkspaceWorkflows(workspaceRoot: string): Promise<void> {
  await writeWorkflowFile(
    workspaceRoot,
    'cc_bug_fix.yaml',
    `
id: cc_bug_fix
description: Bug-fix workflow
stages:
  - ref: triage
    agent: ops
`
  )
  await writeWorkflowFile(
    workspaceRoot,
    'cc_content_creation.yaml',
    `
id: cc_content_creation
description: Content workflow
stages:
  - ref: draft
    agent: ui
`
  )
  await writeWorkflowFile(
    workspaceRoot,
    'cc_greenfield_project.yaml',
    `
id: cc_greenfield_project
description: Greenfield workflow
stages:
  - ref: plan
    agent: plan
  - ref: implement
    agent: build
    type: loop
    loop:
      over: stories
      completion: all_done
`
  )
  await writeWorkflowFile(
    workspaceRoot,
    'cc_ops_change.yaml',
    `
id: cc_ops_change
description: Ops-change workflow
stages:
  - ref: plan
    agent: ops
`
  )
  await writeWorkflowFile(
    workspaceRoot,
    'cc_security_audit.yaml',
    `
id: cc_security_audit
description: Security workflow
stages:
  - ref: audit
    agent: security
`
  )

  await fsp.writeFile(
    join(workspaceRoot, 'workflows', 'workflow-selection.yaml'),
    [
      'defaultWorkflowId: cc_greenfield_project',
      'rules:',
      '  - id: p0_security',
      '    workflowId: cc_security_audit',
      '    priority: [P0]',
      '    tagsAny: [security, vuln]',
      '    precedes: [p0_bugfix]',
      '',
      '  - id: p0_bugfix',
      '    workflowId: cc_bug_fix',
      '    priority: [P0]',
      '    tagsAny: [bug, incident]',
      '',
      '  - id: content_focus',
      '    workflowId: cc_content_creation',
      '    tagsAny: [content, docs]',
      '',
    ].join('\n'),
    'utf8'
  )
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

    await seedWorkspaceWorkflows(tempWorkspace)

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
  it('loads and validates workspace workflow YAML files', async () => {
    const workflows = await listWorkflowConfigs()
    const ids = workflows.map((workflow) => workflow.id)

    expect(ids).toEqual([
      'cc_bug_fix',
      'cc_content_creation',
      'cc_greenfield_project',
      'cc_ops_change',
      'cc_security_audit',
    ])
  })

  it('returns workflow details by id', async () => {
    const workflow = await getWorkflowConfig('cc_greenfield_project')

    expect(workflow).not.toBeNull()
    expect(workflow?.stages.length).toBeGreaterThan(0)
    expect(workflow?.stages.some((stage) => stage.type === 'loop')).toBe(true)
  })

  it('returns selection configuration in snapshot', async () => {
    const snapshot = await getWorkflowRegistrySnapshot()

    expect(snapshot.selectionSource).toBe('custom')
    expect(snapshot.selection.defaultWorkflowId).toBe('cc_greenfield_project')
    expect(snapshot.selection.rules.length).toBeGreaterThan(0)
    expect(snapshot.loadedAt).toContain('T')
  })

  it('generates fallback selection when no overlay exists', async () => {
    await fsp.unlink(join(tempWorkspace, 'workflows', 'workflow-selection.yaml'))
    clearWorkflowRegistryCache()

    const snapshot = await getWorkflowRegistrySnapshot()
    expect(snapshot.selectionSource).toBe('custom')
    expect(snapshot.selection.defaultWorkflowId).toBe('cc_greenfield_project')
    expect(snapshot.selection.rules).toEqual([])
  })
})
