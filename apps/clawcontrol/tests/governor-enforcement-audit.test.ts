import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACTION_POLICIES, type ActionKind } from '@clawcontrol/core'

function listApiRouteFiles(root: string): string[] {
  const out: string[] = []
  const entries = readdirSync(root, { withFileTypes: true })
  for (const entry of entries) {
    const absolute = join(root, entry.name)
    if (entry.isDirectory()) {
      out.push(...listApiRouteFiles(absolute))
      continue
    }
    if (entry.isFile() && absolute.endsWith('.ts')) {
      out.push(absolute)
    }
  }
  return out
}

describe('governor enforcement audit', () => {
  it('keeps work_order.cancel as typed confirm without approval gate', () => {
    const policy = ACTION_POLICIES['work_order.cancel']
    expect(policy.confirmMode).toBe('WO_CODE')
    expect(policy.requiresApproval).toBe(false)
  })

  it('does not use enforceTypedConfirm in API routes', () => {
    const files = listApiRouteFiles(join(process.cwd(), 'app', 'api'))
    const offenders = files.filter((file) => readFileSync(file, 'utf8').includes('enforceTypedConfirm'))
    expect(offenders).toEqual([])
  })

  it('routes with requiresApproval action kinds use enforceActionPolicy', () => {
    const files = listApiRouteFiles(join(process.cwd(), 'app', 'api'))
    const missing: string[] = []

    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      const actionKindMatches = Array.from(source.matchAll(/actionKind:\s*'([^']+)'/g))
      const actionKinds = actionKindMatches.map((m) => m[1] as ActionKind)
      const requiresApproval = actionKinds.some((kind) => ACTION_POLICIES[kind]?.requiresApproval)

      if (requiresApproval && !source.includes('enforceActionPolicy(') && !source.includes('enforceGovernor(')) {
        missing.push(file)
      }
    }

    expect(missing).toEqual([])
  })
})
