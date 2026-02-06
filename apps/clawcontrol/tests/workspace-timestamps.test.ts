import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

describe('workspace timestamps', () => {
  const originalWorkspace = process.env.OPENCLAW_WORKSPACE
  let workspaceRoot = ''

  beforeEach(async () => {
    workspaceRoot = join(tmpdir(), `workspace-test-${randomUUID()}`)
    await fsp.mkdir(join(workspaceRoot, 'memory'), { recursive: true })
    workspaceRoot = await fsp.realpath(workspaceRoot)
    await fsp.mkdir(join(workspaceRoot, 'memory'), { recursive: true })
    await fsp.writeFile(join(workspaceRoot, 'AGENTS.md'), '# test')
    await fsp.writeFile(join(workspaceRoot, 'memory', 'entry.md'), 'hello')

    process.env.OPENCLAW_WORKSPACE = workspaceRoot
    vi.resetModules()
  })

  afterEach(() => {
    process.env.OPENCLAW_WORKSPACE = originalWorkspace
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
})
