import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fsp } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { invalidateAsyncCache } from '@/lib/perf/async-cache'

type CursorRow = {
  sourcePath: string
  deviceId: bigint
  inode: bigint
  offsetBytes: bigint
  fileMtimeMs: bigint
  fileSizeBytes: bigint
}

const cursorRows: CursorRow[] = []
const mockCursorFindMany = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    usageIngestionCursor: {
      findMany: mockCursorFindMany,
    },
  },
}))

async function createSessionFile(input: {
  homeDir: string
  agentId: string
  sessionId: string
  mtimeMs: number
}): Promise<string> {
  const sessionsDir = join(input.homeDir, 'agents', input.agentId, 'sessions')
  await fsp.mkdir(sessionsDir, { recursive: true })

  const sourcePath = join(sessionsDir, `${input.sessionId}.jsonl`)
  await fsp.writeFile(sourcePath, '{"type":"assistant"}\n', 'utf8')

  const stamp = new Date(input.mtimeMs)
  await fsp.utimes(sourcePath, stamp, stamp)
  return sourcePath
}

describe('usage-parity-scope', () => {
  let originalOpenClawHome: string | undefined

  beforeEach(() => {
    invalidateAsyncCache()
    vi.resetModules()

    cursorRows.length = 0
    mockCursorFindMany.mockReset()
    mockCursorFindMany.mockImplementation(async ({ where }: { where: { sourcePath: { in: string[] } } }) => {
      const allowed = new Set(where.sourcePath.in)
      return cursorRows.filter((row) => allowed.has(row.sourcePath))
    })

    originalOpenClawHome = process.env.OPENCLAW_HOME
  })

  afterEach(() => {
    if (originalOpenClawHome === undefined) {
      delete process.env.OPENCLAW_HOME
    } else {
      process.env.OPENCLAW_HOME = originalOpenClawHome
    }
  })

  it('samples the newest sessions in range and reports total sessions in range', async () => {
    const tempHome = await fsp.mkdtemp(join(tmpdir(), 'usage-parity-'))
    process.env.OPENCLAW_HOME = tempHome

    const now = Date.now()
    for (let index = 0; index < 1005; index += 1) {
      await createSessionFile({
        homeDir: tempHome,
        agentId: 'main',
        sessionId: `session-${String(index).padStart(4, '0')}`,
        mtimeMs: now - index * 10,
      })
    }

    const { resolveUsageParityScope } = await import('@/lib/openclaw/usage-parity-scope')

    const result = await resolveUsageParityScope({
      from: new Date(now - 100_000).toISOString(),
      to: new Date(now).toISOString(),
      sessionLimit: 1000,
    })

    expect(result.sampledCount).toBe(1000)
    expect(result.sessionsInRangeTotal).toBe(1005)
    expect(result.sessionIdsSampled[0]).toBe('session-0000')
    expect(result.sessionIdsSampled).not.toContain('session-1004')
    expect(result.missingCoverageCount).toBe(1000)
  })

  it('marks sampled paths as covered only when cursor fingerprint is fully up to date', async () => {
    const tempHome = await fsp.mkdtemp(join(tmpdir(), 'usage-parity-coverage-'))
    process.env.OPENCLAW_HOME = tempHome

    const now = Date.now()
    const pathA = await createSessionFile({
      homeDir: tempHome,
      agentId: 'main',
      sessionId: 'session-a',
      mtimeMs: now,
    })
    const pathB = await createSessionFile({
      homeDir: tempHome,
      agentId: 'main',
      sessionId: 'session-b',
      mtimeMs: now - 1000,
    })
    const pathC = await createSessionFile({
      homeDir: tempHome,
      agentId: 'main',
      sessionId: 'session-c',
      mtimeMs: now - 2000,
    })

    const statA = await fsp.stat(pathA, { bigint: true })
    const statB = await fsp.stat(pathB, { bigint: true })

    cursorRows.push({
      sourcePath: pathA,
      deviceId: statA.dev,
      inode: statA.ino,
      offsetBytes: statA.size,
      fileMtimeMs: BigInt(Math.trunc(Number(statA.mtimeMs))),
      fileSizeBytes: statA.size,
    })

    // Outdated offset means session-b still needs ingestion priority.
    cursorRows.push({
      sourcePath: pathB,
      deviceId: statB.dev,
      inode: statB.ino,
      offsetBytes: statB.size - 1n,
      fileMtimeMs: BigInt(Math.trunc(Number(statB.mtimeMs))),
      fileSizeBytes: statB.size,
    })

    const { resolveUsageParityScope } = await import('@/lib/openclaw/usage-parity-scope')

    const result = await resolveUsageParityScope({
      from: new Date(now - 10_000).toISOString(),
      to: new Date(now).toISOString(),
      sessionLimit: 3,
    })

    expect(result.sampledCount).toBe(3)
    expect(result.missingCoverageCount).toBe(2)
    expect(result.priorityPaths).toEqual([pathB, pathC])
  })
})
