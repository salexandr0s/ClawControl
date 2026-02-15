import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import {
  clearWorkflowRegistryCache,
  selectWorkflowForWorkOrder,
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
  tempWorkspace = join(tmpdir(), `workflow-selection-test-${randomUUID()}`)
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

describe('workflow selector', () => {
  it('routes P0 security incidents to security_audit before bug_fix', async () => {
    const selected = await selectWorkflowForWorkOrder({
      title: 'P0 auth token vulnerability in production',
      goalMd: 'Mitigate auth vulnerability immediately and verify blast radius.',
      tags: ['security', 'incident'],
      priority: 'P0',
    })

    expect(selected.workflowId).toBe('security_audit')
    expect(selected.reason).toBe('rule')
  })

  it('uses explicit requested workflow when provided', async () => {
    const selected = await selectWorkflowForWorkOrder({
      requestedWorkflowId: 'ops_change',
      title: 'Fix dashboard',
      tags: ['bug'],
      priority: 'P0',
    })

    expect(selected.workflowId).toBe('ops_change')
    expect(selected.reason).toBe('explicit')
  })

  it('selects bug_fix for strong bug signals', async () => {
    const selected = await selectWorkflowForWorkOrder({
      title: 'Fix login regression in API',
      goalMd: 'Resolve production bug and add test coverage.',
      tags: ['bug', 'urgent'],
      priority: 'P1',
    })

    expect(selected.workflowId).toBe('bug_fix')
    expect(selected.reason).toBe('rule')
  })

  it('selects security_audit for security-focused work orders', async () => {
    const selected = await selectWorkflowForWorkOrder({
      title: 'Authentication security audit',
      goalMd: 'Audit auth boundaries and report vulnerabilities.',
      tags: ['security'],
      priority: 'P2',
    })

    expect(selected.workflowId).toBe('security_audit')
    expect(selected.reason).toBe('rule')
  })

  it('falls back to default workflow when no rule matches', async () => {
    const selected = await selectWorkflowForWorkOrder({
      title: 'Build new onboarding dashboard',
      goalMd: 'Greenfield project for onboarding analytics.',
      tags: ['feature'],
      priority: 'P2',
    })

    expect(selected.workflowId).toBe('greenfield_project')
    expect(selected.reason).toBe('default')
  })
})
