import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ensureWorkspaceScaffold } from '@/lib/workspace/bootstrap'

describe('ensureWorkspaceScaffold (main agent files)', () => {
  let workspaceRoot: string

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'clawcontrol-workspace-'))
  })

  afterEach(async () => {
    if (!workspaceRoot) return
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  it('creates agents/main/SOUL.md and agents/main/HEARTBEAT.md on fresh workspace', async () => {
    const result = await ensureWorkspaceScaffold(workspaceRoot)
    expect(result.ensured).toBe(true)

    const soulPath = join(workspaceRoot, 'agents', 'main', 'SOUL.md')
    const heartbeatPath = join(workspaceRoot, 'agents', 'main', 'HEARTBEAT.md')

    const soul = await readFile(soulPath, 'utf8')
    const heartbeat = await readFile(heartbeatPath, 'utf8')

    expect(soul).toContain('ClawcontrolCEO (main)')
    expect(heartbeat).toContain('HEARTBEAT_OK')

    expect(result.createdFiles).toContain(soulPath)
    expect(result.createdFiles).toContain(heartbeatPath)
  })

  it('does not overwrite existing main SOUL.md (creates missing HEARTBEAT.md only)', async () => {
    const soulPath = join(workspaceRoot, 'agents', 'main', 'SOUL.md')
    const heartbeatPath = join(workspaceRoot, 'agents', 'main', 'HEARTBEAT.md')

    await mkdir(join(workspaceRoot, 'agents', 'main'), { recursive: true })
    await writeFile(soulPath, 'CUSTOM_SOUL\n', 'utf8')

    const result = await ensureWorkspaceScaffold(workspaceRoot)

    const soul = await readFile(soulPath, 'utf8')
    const heartbeat = await readFile(heartbeatPath, 'utf8')

    expect(soul).toBe('CUSTOM_SOUL\n')
    expect(heartbeat).toContain('HEARTBEAT_OK')

    expect(result.createdFiles).not.toContain(soulPath)
    expect(result.createdFiles).toContain(heartbeatPath)
  })
})
