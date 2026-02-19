import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fsp } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type CursorRow = {
  sourcePath: string
  agentId: string
  sessionId: string
  deviceId: bigint
  inode: bigint
  offsetBytes: bigint
  fileMtimeMs: bigint
  fileSizeBytes: bigint
  updatedAt: Date
}

type SessionUsageRow = {
  sessionId: string
  agentId: string
  sessionKey: string | null
  source: string | null
  channel: string | null
  sessionKind: string | null
  sessionClass: string | null
  providerKey: string | null
  operationId: string | null
  workOrderId: string | null
  model: string | null
  inputTokens: bigint
  outputTokens: bigint
  cacheReadTokens: bigint
  cacheWriteTokens: bigint
  totalTokens: bigint
  totalCostMicros: bigint
  hasErrors: boolean
  firstSeenAt: Date | null
  lastSeenAt: Date | null
}

const cursorStore = new Map<string, CursorRow>()
const sessionStore = new Map<string, SessionUsageRow>()
const dailyUsageStore = new Map<string, {
  inputTokens: bigint
  outputTokens: bigint
  cacheReadTokens: bigint
  cacheWriteTokens: bigint
  totalTokens: bigint
  totalCostMicros: bigint
}>()
const hourlyUsageStore = new Map<string, {
  inputTokens: bigint
  outputTokens: bigint
  cacheReadTokens: bigint
  cacheWriteTokens: bigint
  totalTokens: bigint
  totalCostMicros: bigint
}>()
const toolDailyStore = new Map<string, bigint>()
const sessionToolStore = new Map<string, bigint>()

const mocks = vi.hoisted(() => ({
  mockCursorFindMany: vi.fn(),
  mockCursorUpsert: vi.fn(),
  mockSessionFindUnique: vi.fn(),
  mockSessionCreate: vi.fn(),
  mockSessionUpdate: vi.fn(),
  mockDailyUpsert: vi.fn(),
  mockHourlyUpsert: vi.fn(),
  mockToolDailyUpsert: vi.fn(),
  mockSessionToolUpsert: vi.fn(),
  mockAgentSessionFindUnique: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    usageIngestionCursor: {
      findMany: mocks.mockCursorFindMany,
      upsert: mocks.mockCursorUpsert,
    },
    sessionUsageAggregate: {
      findUnique: mocks.mockSessionFindUnique,
      create: mocks.mockSessionCreate,
      update: mocks.mockSessionUpdate,
    },
    sessionUsageDailyAggregate: {
      upsert: mocks.mockDailyUpsert,
    },
    sessionUsageHourlyAggregate: {
      upsert: mocks.mockHourlyUpsert,
    },
    sessionToolUsageDailyAggregate: {
      upsert: mocks.mockToolDailyUpsert,
    },
    sessionToolUsage: {
      upsert: mocks.mockSessionToolUpsert,
    },
    agentSession: {
      findUnique: mocks.mockAgentSessionFindUnique,
    },
  },
}))

import { buildSyncFileQueue, syncUsageTelemetry } from '@/lib/openclaw/usage-sync'

let originalOpenClawHome: string | undefined

function dailyKey(sessionId: string, dayStart: Date, modelKey: string): string {
  return `${sessionId}|${dayStart.toISOString()}|${modelKey}`
}

function hourlyKey(sessionId: string, hourStart: Date, modelKey: string): string {
  return `${sessionId}|${hourStart.toISOString()}|${modelKey}`
}

function toolDailyKey(sessionId: string, dayStart: Date, toolName: string): string {
  return `${sessionId}|${dayStart.toISOString()}|${toolName}`
}

function sessionToolKey(sessionId: string, toolName: string): string {
  return `${sessionId}|${toolName}`
}

describe('usage-sync queue scheduling', () => {
  beforeEach(() => {
    cursorStore.clear()
    sessionStore.clear()
    dailyUsageStore.clear()
    hourlyUsageStore.clear()
    toolDailyStore.clear()
    sessionToolStore.clear()

    mocks.mockCursorFindMany.mockReset()
    mocks.mockCursorUpsert.mockReset()
    mocks.mockSessionFindUnique.mockReset()
    mocks.mockSessionCreate.mockReset()
    mocks.mockSessionUpdate.mockReset()
    mocks.mockDailyUpsert.mockReset()
    mocks.mockHourlyUpsert.mockReset()
    mocks.mockToolDailyUpsert.mockReset()
    mocks.mockSessionToolUpsert.mockReset()
    mocks.mockAgentSessionFindUnique.mockReset()

    mocks.mockCursorFindMany.mockImplementation(async () => Array.from(cursorStore.values()))

    mocks.mockCursorUpsert.mockImplementation(async ({ create, update }: { create: CursorRow; update: Omit<CursorRow, 'sourcePath' | 'createdAt'> }) => {
      const sourcePath = create.sourcePath
      const prev = cursorStore.get(sourcePath)

      if (!prev) {
        cursorStore.set(sourcePath, {
          ...create,
          updatedAt: new Date(),
        })
        return
      }

      cursorStore.set(sourcePath, {
        ...prev,
        ...update,
        updatedAt: new Date(),
      })
    })

    mocks.mockSessionFindUnique.mockImplementation(async ({ where }: { where: { sessionId: string } }) => {
      return sessionStore.get(where.sessionId) ?? null
    })

    mocks.mockSessionCreate.mockImplementation(async ({ data }: { data: SessionUsageRow }) => {
      sessionStore.set(data.sessionId, { ...data })
      return data
    })

    mocks.mockSessionUpdate.mockImplementation(async ({ where, data }: { where: { sessionId: string }; data: SessionUsageRow }) => {
      sessionStore.set(where.sessionId, { ...data, sessionId: where.sessionId })
      return sessionStore.get(where.sessionId)
    })

    mocks.mockDailyUpsert.mockImplementation(async ({ where, create, update }: {
      where: { sessionId_dayStart_modelKey: { sessionId: string; dayStart: Date; modelKey: string } }
      create: {
        inputTokens: bigint
        outputTokens: bigint
        cacheReadTokens: bigint
        cacheWriteTokens: bigint
        totalTokens: bigint
        totalCostMicros: bigint
      }
      update: {
        inputTokens: { increment: bigint }
        outputTokens: { increment: bigint }
        cacheReadTokens: { increment: bigint }
        cacheWriteTokens: { increment: bigint }
        totalTokens: { increment: bigint }
        totalCostMicros: { increment: bigint }
      }
    }) => {
      const key = dailyKey(
        where.sessionId_dayStart_modelKey.sessionId,
        where.sessionId_dayStart_modelKey.dayStart,
        where.sessionId_dayStart_modelKey.modelKey
      )

      const prev = dailyUsageStore.get(key)
      if (!prev) {
        dailyUsageStore.set(key, {
          inputTokens: create.inputTokens,
          outputTokens: create.outputTokens,
          cacheReadTokens: create.cacheReadTokens,
          cacheWriteTokens: create.cacheWriteTokens,
          totalTokens: create.totalTokens,
          totalCostMicros: create.totalCostMicros,
        })
        return
      }

      dailyUsageStore.set(key, {
        inputTokens: prev.inputTokens + update.inputTokens.increment,
        outputTokens: prev.outputTokens + update.outputTokens.increment,
        cacheReadTokens: prev.cacheReadTokens + update.cacheReadTokens.increment,
        cacheWriteTokens: prev.cacheWriteTokens + update.cacheWriteTokens.increment,
        totalTokens: prev.totalTokens + update.totalTokens.increment,
        totalCostMicros: prev.totalCostMicros + update.totalCostMicros.increment,
      })
    })

    mocks.mockHourlyUpsert.mockImplementation(async ({ where, create, update }: {
      where: { sessionId_hourStart_modelKey: { sessionId: string; hourStart: Date; modelKey: string } }
      create: {
        inputTokens: bigint
        outputTokens: bigint
        cacheReadTokens: bigint
        cacheWriteTokens: bigint
        totalTokens: bigint
        totalCostMicros: bigint
      }
      update: {
        inputTokens: { increment: bigint }
        outputTokens: { increment: bigint }
        cacheReadTokens: { increment: bigint }
        cacheWriteTokens: { increment: bigint }
        totalTokens: { increment: bigint }
        totalCostMicros: { increment: bigint }
      }
    }) => {
      const key = hourlyKey(
        where.sessionId_hourStart_modelKey.sessionId,
        where.sessionId_hourStart_modelKey.hourStart,
        where.sessionId_hourStart_modelKey.modelKey
      )

      const prev = hourlyUsageStore.get(key)
      if (!prev) {
        hourlyUsageStore.set(key, {
          inputTokens: create.inputTokens,
          outputTokens: create.outputTokens,
          cacheReadTokens: create.cacheReadTokens,
          cacheWriteTokens: create.cacheWriteTokens,
          totalTokens: create.totalTokens,
          totalCostMicros: create.totalCostMicros,
        })
        return
      }

      hourlyUsageStore.set(key, {
        inputTokens: prev.inputTokens + update.inputTokens.increment,
        outputTokens: prev.outputTokens + update.outputTokens.increment,
        cacheReadTokens: prev.cacheReadTokens + update.cacheReadTokens.increment,
        cacheWriteTokens: prev.cacheWriteTokens + update.cacheWriteTokens.increment,
        totalTokens: prev.totalTokens + update.totalTokens.increment,
        totalCostMicros: prev.totalCostMicros + update.totalCostMicros.increment,
      })
    })

    mocks.mockToolDailyUpsert.mockImplementation(async ({ where, create, update }: {
      where: { sessionId_dayStart_toolName: { sessionId: string; dayStart: Date; toolName: string } }
      create: { callCount: bigint }
      update: { callCount: { increment: bigint } }
    }) => {
      const key = toolDailyKey(
        where.sessionId_dayStart_toolName.sessionId,
        where.sessionId_dayStart_toolName.dayStart,
        where.sessionId_dayStart_toolName.toolName
      )

      const prev = toolDailyStore.get(key)
      toolDailyStore.set(key, prev ? prev + update.callCount.increment : create.callCount)
    })

    mocks.mockSessionToolUpsert.mockImplementation(async ({ where, create, update }: {
      where: { sessionId_toolName: { sessionId: string; toolName: string } }
      create: { callCount: bigint }
      update: { callCount: { increment: bigint } }
    }) => {
      const key = sessionToolKey(where.sessionId_toolName.sessionId, where.sessionId_toolName.toolName)
      const prev = sessionToolStore.get(key)
      sessionToolStore.set(key, prev ? prev + update.callCount.increment : create.callCount)
    })

    mocks.mockAgentSessionFindUnique.mockResolvedValue({
      sessionKey: 'telegram:agent-a:main',
      kind: 'chat',
      rawJson: JSON.stringify({ channel: 'telegram' }),
      operationId: null,
      workOrderId: null,
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

  it('prioritizes unseen files and reaches full coverage across bounded runs', () => {
    const files = ['a.jsonl', 'b.jsonl', 'c.jsonl', 'd.jsonl', 'e.jsonl']
    const maxFilesPerRun = 2
    const mtimeByPath = new Map<string, number>([
      ['a.jsonl', 100],
      ['b.jsonl', 200],
      ['c.jsonl', 300],
      ['d.jsonl', 400],
      ['e.jsonl', 500],
    ])

    const cursors = new Map<string, { updatedAt: Date }>()
    const visited = new Set<string>()

    const firstRunQueue = buildSyncFileQueue(files, cursors, { fileMtimeMsByPath: mtimeByPath })
    expect(firstRunQueue).toEqual(['e.jsonl', 'd.jsonl', 'c.jsonl', 'b.jsonl', 'a.jsonl'])

    let run = 0
    while (visited.size < files.length && run < 10) {
      const queue = buildSyncFileQueue(files, cursors, { fileMtimeMsByPath: mtimeByPath })
      const batch = queue.slice(0, maxFilesPerRun)

      for (const [index, filePath] of batch.entries()) {
        visited.add(filePath)
        cursors.set(filePath, {
          updatedAt: new Date(1_700_000_000_000 + run * 10_000 + index),
        })
      }

      run += 1
    }

    expect(visited.size).toBe(files.length)
    expect(run).toBeLessThanOrEqual(3)
  })

  it('places explicit priority paths first', () => {
    const files = ['a.jsonl', 'b.jsonl', 'c.jsonl']
    const cursors = new Map<string, { updatedAt: Date }>([
      ['b.jsonl', { updatedAt: new Date('2026-02-08T00:00:00.000Z') }],
    ])

    const queue = buildSyncFileQueue(files, cursors, {
      priorityPaths: ['b.jsonl', 'a.jsonl', 'missing.jsonl', 'b.jsonl'],
      fileMtimeMsByPath: new Map<string, number>([
        ['a.jsonl', 100],
        ['b.jsonl', 300],
        ['c.jsonl', 200],
      ]),
    })

    expect(queue).toEqual(['b.jsonl', 'a.jsonl', 'c.jsonl'])
  })

  it('orders unseen files by newest file mtime', () => {
    const files = ['a.jsonl', 'b.jsonl', 'c.jsonl']
    const cursors = new Map<string, { updatedAt: Date }>()

    const queue = buildSyncFileQueue(files, cursors, {
      fileMtimeMsByPath: new Map<string, number>([
        ['a.jsonl', 100],
        ['b.jsonl', 300],
        ['c.jsonl', 200],
      ]),
    })

    expect(queue).toEqual(['b.jsonl', 'c.jsonl', 'a.jsonl'])
  })

  it('orders previously seen files by oldest cursor update time', () => {
    const files = ['a.jsonl', 'b.jsonl', 'c.jsonl']
    const cursors = new Map<string, { updatedAt: Date }>([
      ['a.jsonl', { updatedAt: new Date('2026-02-10T00:00:00.000Z') }],
      ['b.jsonl', { updatedAt: new Date('2026-02-08T00:00:00.000Z') }],
      ['c.jsonl', { updatedAt: new Date('2026-02-09T00:00:00.000Z') }],
    ])

    const queue = buildSyncFileQueue(files, cursors)
    expect(queue).toEqual(['b.jsonl', 'c.jsonl', 'a.jsonl'])
  })

  it('increments hourly and tool-daily aggregates across repeated sync runs', async () => {
    const tempHome = await fsp.mkdtemp(join(tmpdir(), 'usage-sync-'))
    process.env.OPENCLAW_HOME = tempHome

    const sessionsDir = join(tempHome, 'agents', 'agent-a', 'sessions')
    await fsp.mkdir(sessionsDir, { recursive: true })

    const filePath = join(sessionsDir, 'session-1.jsonl')
    const line1 = JSON.stringify({
      createdAt: '2026-02-05T10:05:00.000Z',
      model: 'gpt-5.2',
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 2,
        cacheWriteTokens: 1,
        totalTokens: 18,
        cost: 0.0004,
      },
      content: [{ type: 'toolCall', name: 'read' }],
    })

    const line2 = JSON.stringify({
      createdAt: '2026-02-05T10:15:00.000Z',
      model: 'gpt-5.2',
      usage: {
        inputTokens: 20,
        outputTokens: 4,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 24,
        cost: 0.0006,
      },
      content: [
        { type: 'toolCall', name: 'read' },
        { type: 'toolCall', name: 'write' },
      ],
    })

    await fsp.writeFile(filePath, `${line1}\n`, 'utf8')

    const first = await syncUsageTelemetry({ maxMs: 10_000, maxFiles: 10 })
    expect(first.sessionsUpdated).toBe(1)

    await fsp.appendFile(filePath, `${line2}\n`, 'utf8')

    const second = await syncUsageTelemetry({ maxMs: 10_000, maxFiles: 10 })
    expect(second.sessionsUpdated).toBe(1)

    const hourKey = hourlyKey('session-1', new Date('2026-02-05T10:00:00.000Z'), 'gpt-5.2')
    const hourTotals = hourlyUsageStore.get(hourKey)
    expect(hourTotals).toBeTruthy()
    expect(hourTotals?.totalTokens).toBe(42n)
    expect(hourTotals?.totalCostMicros).toBe(1000n)

    const readToolKey = toolDailyKey('session-1', new Date('2026-02-05T00:00:00.000Z'), 'read')
    const writeToolKey = toolDailyKey('session-1', new Date('2026-02-05T00:00:00.000Z'), 'write')

    expect(toolDailyStore.get(readToolKey)).toBe(2n)
    expect(toolDailyStore.get(writeToolKey)).toBe(1n)
  })
})
