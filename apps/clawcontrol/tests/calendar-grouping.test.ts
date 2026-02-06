import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

describe('workspace calendar grouping', () => {
  const originalWorkspace = process.env.OPENCLAW_WORKSPACE
  let workspaceRoot = ''

  beforeEach(async () => {
    workspaceRoot = join(tmpdir(), `workspace-test-${randomUUID()}`)
    await fsp.mkdir(join(workspaceRoot, 'memory'), { recursive: true })
    workspaceRoot = await fsp.realpath(workspaceRoot)
    await fsp.mkdir(join(workspaceRoot, 'memory'), { recursive: true })
    await fsp.writeFile(join(workspaceRoot, 'AGENTS.md'), '# test')
    await fsp.writeFile(join(workspaceRoot, 'memory', '2026-02-01.md'), 'a')
    await fsp.writeFile(join(workspaceRoot, 'memory', '2026-02-15.md'), 'b')
    await fsp.writeFile(join(workspaceRoot, 'memory', 'notes.md'), 'c')

    process.env.OPENCLAW_WORKSPACE = workspaceRoot
    vi.resetModules()
  })

  afterEach(() => {
    process.env.OPENCLAW_WORKSPACE = originalWorkspace
  })

  it('returns only YYYY-MM-DD.md files grouped by day', async () => {
    const { getWorkspaceCalendar } = await import('@/lib/workspace/calendar-index')
    const result = await getWorkspaceCalendar({ month: '2026-02', root: 'memory' })

    expect(result.days.map((d) => d.day)).toEqual(['2026-02-01', '2026-02-15'])
    expect(result.days[0]?.count).toBe(1)
    expect(result.days[1]?.files[0]?.name).toBe('2026-02-15.md')
  })
})
