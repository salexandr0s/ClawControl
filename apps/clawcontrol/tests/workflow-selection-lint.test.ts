import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import {
  clearWorkflowRegistryCache,
  getWorkflowRegistrySnapshot,
} from '@/lib/workflows/registry'
import type { WorkflowSelectionRule } from '@clawcontrol/core'
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

async function seedWorkflowSelectionFixture(workspaceRoot: string): Promise<void> {
  const workflowsDir = join(workspaceRoot, 'workflows')
  await fsp.mkdir(workflowsDir, { recursive: true })

  await Promise.all([
    fsp.writeFile(
      join(workflowsDir, 'cc_bug_fix.yaml'),
      'id: cc_bug_fix\ndescription: Bug-fix\nstages:\n  - ref: triage\n    agent: ops\n',
      'utf8'
    ),
    fsp.writeFile(
      join(workflowsDir, 'cc_security_audit.yaml'),
      'id: cc_security_audit\ndescription: Security\nstages:\n  - ref: audit\n    agent: security\n',
      'utf8'
    ),
    fsp.writeFile(
      join(workflowsDir, 'cc_greenfield_project.yaml'),
      'id: cc_greenfield_project\ndescription: Greenfield\nstages:\n  - ref: plan\n    agent: plan\n',
      'utf8'
    ),
  ])

  await fsp.writeFile(
    join(workflowsDir, 'workflow-selection.yaml'),
    [
      'defaultWorkflowId: cc_greenfield_project',
      'rules:',
      '  - id: p0_security',
      '    workflowId: cc_security_audit',
      '    priority: [P0]',
      '    tagsAny: [security, bug]',
      '    precedes: [p0_bugfix]',
      '',
      '  - id: p0_bugfix',
      '    workflowId: cc_bug_fix',
      '    priority: [P0]',
      '    tagsAny: [bug, incident]',
      '',
    ].join('\n'),
    'utf8'
  )
}

beforeEach(async () => {
  tempWorkspace = join(tmpdir(), `workflow-selection-lint-test-${randomUUID()}`)
  await fsp.mkdir(tempWorkspace, { recursive: true })
  process.env.OPENCLAW_WORKSPACE = tempWorkspace
  process.env.CLAWCONTROL_SETTINGS_PATH = join(tempWorkspace, 'settings.json')
  delete process.env.CLAWCONTROL_WORKSPACE_ROOT
  delete process.env.WORKSPACE_ROOT
  await fsp.writeFile(
    process.env.CLAWCONTROL_SETTINGS_PATH,
    JSON.stringify({ workspacePath: tempWorkspace, updatedAt: new Date().toISOString() })
  )

  await seedWorkflowSelectionFixture(tempWorkspace)

  invalidateWorkspaceRootCache()
  clearWorkflowRegistryCache()
})

afterEach(async () => {
  restoreEnv('OPENCLAW_WORKSPACE', originalOpenClawWorkspace)
  restoreEnv('CLAWCONTROL_SETTINGS_PATH', originalSettingsPath)
  restoreEnv('CLAWCONTROL_WORKSPACE_ROOT', originalClawcontrolWorkspaceRoot)
  restoreEnv('WORKSPACE_ROOT', originalWorkspaceRoot)

  invalidateWorkspaceRootCache()
  clearWorkflowRegistryCache()

  const workspaceToRemove = tempWorkspace
  tempWorkspace = ''
  if (!workspaceToRemove) return
  await fsp.rm(workspaceToRemove, { recursive: true, force: true })
})

function normalizeList(values: string[] | undefined): Set<string> {
  return new Set((values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean))
}

function setsIntersect(left: Set<string>, right: Set<string>): boolean {
  for (const value of left) {
    if (right.has(value)) return true
  }
  return false
}

function prioritiesOverlap(left: WorkflowSelectionRule, right: WorkflowSelectionRule): boolean {
  const leftSet = normalizeList(left.priority)
  const rightSet = normalizeList(right.priority)
  if (leftSet.size === 0 || rightSet.size === 0) return true
  return setsIntersect(leftSet, rightSet)
}

function likelyOverlap(left: WorkflowSelectionRule, right: WorkflowSelectionRule): boolean {
  if (!prioritiesOverlap(left, right)) return false

  const tagsOverlap = setsIntersect(normalizeList(left.tagsAny), normalizeList(right.tagsAny))
  const titleOverlap = setsIntersect(
    normalizeList(left.titleKeywordsAny),
    normalizeList(right.titleKeywordsAny)
  )
  const goalOverlap = setsIntersect(
    normalizeList(left.goalKeywordsAny),
    normalizeList(right.goalKeywordsAny)
  )

  const leftSignals =
    (left.tagsAny?.length ?? 0) +
    (left.titleKeywordsAny?.length ?? 0) +
    (left.goalKeywordsAny?.length ?? 0)
  const rightSignals =
    (right.tagsAny?.length ?? 0) +
    (right.titleKeywordsAny?.length ?? 0) +
    (right.goalKeywordsAny?.length ?? 0)

  if (leftSignals === 0 && rightSignals === 0) return true
  return tagsOverlap || titleOverlap || goalOverlap
}

function hasExplicitPrecedence(left: WorkflowSelectionRule, right: WorkflowSelectionRule): boolean {
  return (left.precedes ?? []).includes(right.id) || (right.precedes ?? []).includes(left.id)
}

describe('workflow-selection lint', () => {
  it('requires explicit precedence annotation for likely-overlapping rules', async () => {
    const snapshot = await getWorkflowRegistrySnapshot()
    const rules = snapshot.selection.rules
    const missing: string[] = []

    for (let i = 0; i < rules.length; i++) {
      for (let j = i + 1; j < rules.length; j++) {
        const left = rules[i]
        const right = rules[j]
        if (!likelyOverlap(left, right)) continue
        if (hasExplicitPrecedence(left, right)) continue
        missing.push(`${left.id} <-> ${right.id}`)
      }
    }

    expect(
      missing,
      `Missing explicit precedence annotation for likely-overlapping rules: ${missing.join(', ')}`
    ).toEqual([])
  })
})
