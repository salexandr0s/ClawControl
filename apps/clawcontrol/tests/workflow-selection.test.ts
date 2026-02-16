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
      '  - id: p0_security_tags',
      '    workflowId: cc_security_audit',
      '    priority: [P0]',
      '    tagsAny: [security, audit, vuln, vulnerability, auth, permissions]',
      '    precedes: [p0_bugfix, security_focus]',
      '',
      '  - id: p0_bugfix',
      '    workflowId: cc_bug_fix',
      '    priority: [P0]',
      '    precedes: [bug_tags_keywords, security_focus, ops_focus, content_focus]',
      '',
      '  - id: bug_tags_keywords',
      '    workflowId: cc_bug_fix',
      '    tagsAny: [bug, hotfix, incident, regression]',
      '    titleKeywordsAny: [bug, fix, hotfix, regression]',
      '    goalKeywordsAny: [bug, fix, regression, incident]',
      '',
      '  - id: security_focus',
      '    workflowId: cc_security_audit',
      '    tagsAny: [security, audit, vuln, vulnerability, auth]',
      '    titleKeywordsAny: [security, audit, vulnerability, auth, permissions]',
      '    goalKeywordsAny: [security, audit, vulnerability, auth, permissions]',
      '',
      '  - id: ops_focus',
      '    workflowId: cc_ops_change',
      '    tagsAny: [ops, infrastructure, infra, deploy, sre, platform]',
      '    titleKeywordsAny: [ops, infrastructure, deploy, migration, platform]',
      '    goalKeywordsAny: [ops, infrastructure, deploy, migration, runbook]',
      '',
      '  - id: content_focus',
      '    workflowId: cc_content_creation',
      '    tagsAny: [content, docs, documentation, blog, marketing]',
      '    titleKeywordsAny: [content, docs, documentation, article, blog]',
      '    goalKeywordsAny: [content, docs, documentation, blog, article]',
      '',
    ].join('\n'),
    'utf8'
  )
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

describe('workflow selector', () => {
  it('routes P0 security incidents to cc_security_audit before cc_bug_fix', async () => {
    const selected = await selectWorkflowForWorkOrder({
      title: 'P0 auth token vulnerability in production',
      goalMd: 'Mitigate auth vulnerability immediately and verify blast radius.',
      tags: ['security', 'incident'],
      priority: 'P0',
    })

    expect(selected.workflowId).toBe('cc_security_audit')
    expect(selected.reason).toBe('rule')
  })

  it('uses explicit requested workflow when provided', async () => {
    const selected = await selectWorkflowForWorkOrder({
      requestedWorkflowId: 'cc_ops_change',
      title: 'Fix dashboard',
      tags: ['bug'],
      priority: 'P0',
    })

    expect(selected.workflowId).toBe('cc_ops_change')
    expect(selected.reason).toBe('explicit')
  })

  it('selects cc_bug_fix for strong bug signals', async () => {
    const selected = await selectWorkflowForWorkOrder({
      title: 'Fix login regression in API',
      goalMd: 'Resolve production bug and add test coverage.',
      tags: ['bug', 'urgent'],
      priority: 'P1',
    })

    expect(selected.workflowId).toBe('cc_bug_fix')
    expect(selected.reason).toBe('rule')
  })

  it('selects cc_security_audit for security-focused work orders', async () => {
    const selected = await selectWorkflowForWorkOrder({
      title: 'Authentication security audit',
      goalMd: 'Audit auth boundaries and report vulnerabilities.',
      tags: ['security'],
      priority: 'P2',
    })

    expect(selected.workflowId).toBe('cc_security_audit')
    expect(selected.reason).toBe('rule')
  })

  it('falls back to default workflow when no rule matches', async () => {
    const selected = await selectWorkflowForWorkOrder({
      title: 'Build new onboarding dashboard',
      goalMd: 'Greenfield project for onboarding analytics.',
      tags: ['feature'],
      priority: 'P2',
    })

    expect(selected.workflowId).toBe('cc_greenfield_project')
    expect(selected.reason).toBe('default')
  })
})
