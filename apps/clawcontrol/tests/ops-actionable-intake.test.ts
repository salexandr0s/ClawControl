import { beforeEach, describe, expect, it, vi } from 'vitest'

type EventRow = {
  id: string
  fingerprint: string
  source: string
  jobId: string | null
  jobName: string | null
  runAtMs: bigint | null
  teamId: string | null
  opsRuntimeAgentId: string | null
  relayKey: string | null
  severity: string
  decisionRequired: boolean
  summary: string
  recommendation: string
  evidenceJson: string
  workOrderId: string | null
  relayedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

const state = vi.hoisted(() => ({
  events: [] as EventRow[],
  workOrders: [] as Array<{ id: string; title: string }>,
}))

function pickFields<T extends Record<string, unknown>>(
  row: T,
  select?: Record<string, boolean>
): Record<string, unknown> {
  if (!select) return row
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(select)) {
    if (!select[key]) continue
    out[key] = row[key]
  }
  return out
}

vi.mock('@/lib/db', () => ({
  prisma: {
    agent: {
      findFirst: vi.fn(async () => ({ id: 'agent_ops', teamId: 'team_default' })),
    },
    agentTeam: {
      findUnique: vi.fn(async ({ where }) => {
        if (where?.id === 'team_a') {
          return {
            id: 'team_a',
            slug: 'team-a',
            governanceJson: JSON.stringify({
              orchestratorTemplateId: 'manager',
              agentIdentityMode: 'team_scoped',
              ops: {
                templateId: 'ops',
                relayMode: 'decision_only',
                relayTargetSessionKey: 'agent:main:main',
                pollerEnabled: true,
                pollIntervalCron: '*/15 * * * *',
                timezone: 'Europe/Zurich',
              },
            }),
          }
        }
        if (where?.id === 'team_b') {
          return {
            id: 'team_b',
            slug: 'team-b',
            governanceJson: JSON.stringify({
              orchestratorTemplateId: 'manager',
              agentIdentityMode: 'team_scoped',
              ops: {
                templateId: 'ops',
                relayMode: 'decision_only',
                relayTargetSessionKey: 'agent:main:main',
                pollerEnabled: true,
                pollIntervalCron: '*/15 * * * *',
                timezone: 'Europe/Zurich',
              },
            }),
          }
        }
        return null
      }),
    },
    opsActionableEvent: {
      create: vi.fn(async ({ data, select }) => {
        const fingerprint = data.fingerprint as string
        if (state.events.some((row) => row.fingerprint === fingerprint)) {
          throw { code: 'P2002' }
        }

        const now = new Date()
        const row: EventRow = {
          id: `evt_${state.events.length + 1}`,
          fingerprint,
          source: data.source as string,
          jobId: (data.jobId as string | null) ?? null,
          jobName: (data.jobName as string | null) ?? null,
          runAtMs: (data.runAtMs as bigint | null) ?? null,
          teamId: (data.teamId as string | null) ?? null,
          opsRuntimeAgentId: (data.opsRuntimeAgentId as string | null) ?? null,
          relayKey: (data.relayKey as string | null) ?? null,
          severity: data.severity as string,
          decisionRequired: Boolean(data.decisionRequired),
          summary: data.summary as string,
          recommendation: data.recommendation as string,
          evidenceJson: data.evidenceJson as string,
          workOrderId: (data.workOrderId as string | null) ?? null,
          relayedAt: null,
          createdAt: now,
          updatedAt: now,
        }
        state.events.push(row)
        return pickFields(row, select)
      }),
      findUnique: vi.fn(async ({ where, select }) => {
        const row = state.events.find((entry) => entry.fingerprint === where.fingerprint)
        if (!row) return null
        return pickFields(row, select)
      }),
      update: vi.fn(async ({ where, data, select }) => {
        const row = state.events.find((entry) => entry.id === where.id)
        if (!row) throw new Error('missing row')
        if (data.workOrderId !== undefined) row.workOrderId = data.workOrderId
        if (data.relayedAt !== undefined) row.relayedAt = data.relayedAt
        row.updatedAt = new Date()
        return pickFields(row, select)
      }),
      findMany: vi.fn(async ({ where, orderBy, take, select }) => {
        let rows = [...state.events]
        if (where?.relayedAt === null) {
          rows = rows.filter((row) => row.relayedAt === null)
        }
        if (where?.id?.in) {
          const ids = new Set(where.id.in as string[])
          rows = rows.filter((row) => ids.has(row.id))
        }
        if (orderBy?.createdAt === 'asc') {
          rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        }
        if (typeof take === 'number') {
          rows = rows.slice(0, take)
        }
        return rows.map((row) => pickFields(row, select))
      }),
      updateMany: vi.fn(async ({ where, data }) => {
        const ids = new Set((where?.id?.in as string[]) ?? [])
        let count = 0
        for (const row of state.events) {
          if (!ids.has(row.id)) continue
          if (where?.relayedAt === null && row.relayedAt !== null) continue
          row.relayedAt = data.relayedAt as Date
          row.updatedAt = new Date()
          count += 1
        }
        return { count }
      }),
    },
    $transaction: vi.fn(async (callback) => {
      const tx = {
        opsActionableEvent: {
          findMany: async ({ where, orderBy, take, select }: any) => {
            let rows = [...state.events]
            if (where?.relayedAt === null) {
              rows = rows.filter((row) => row.relayedAt === null)
            }
            if (where?.id?.in) {
              const ids = new Set(where.id.in as string[])
              rows = rows.filter((row) => ids.has(row.id))
            }
            if (orderBy?.createdAt === 'asc') {
              rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
            }
            if (typeof take === 'number') {
              rows = rows.slice(0, take)
            }
            return rows.map((row) => pickFields(row, select))
          },
          updateMany: async ({ where, data }: any) => {
            const ids = new Set((where?.id?.in as string[]) ?? [])
            let count = 0
            for (const row of state.events) {
              if (!ids.has(row.id)) continue
              if (where?.relayedAt === null && row.relayedAt !== null) continue
              row.relayedAt = data.relayedAt as Date
              row.updatedAt = new Date()
              count += 1
            }
            return { count }
          },
        },
      }
      return callback(tx)
    }),
  },
}))

vi.mock('@/lib/repo', () => ({
  getRepos: () => ({
    workOrders: {
      create: async (input: { title: string }) => {
        const id = `wo_${state.workOrders.length + 1}`
        state.workOrders.push({ id, title: input.title })
        return { id }
      },
    },
  }),
}))

describe('ops actionable intake service', () => {
  beforeEach(() => {
    vi.resetModules()
    state.events.length = 0
    state.workOrders.length = 0
  })

  it('dedupes by fingerprint and creates only one work order', async () => {
    const mod = await import('@/lib/services/ops-actionable-intake')

    const payload = {
      source: 'cron',
      jobId: 'job_1',
      runAtMs: 1739960000000,
      severity: 'high',
      summary: 'Gateway errors spiked',
      recommendation: 'Rollback latest deploy',
      evidenceJson: { log: 'ops.log#L42' },
    }

    const first = await mod.ingestOpsActionableEvent(payload)
    const second = await mod.ingestOpsActionableEvent(payload)

    expect(first.ignored).toBe(false)
    expect(first.deduped).toBe(false)
    expect(first.created).toBe(true)
    expect(second.deduped).toBe(true)
    expect(state.events).toHaveLength(1)
    expect(state.workOrders).toHaveLength(1)
  })

  it('marks polled events as relayed and returns empty on second poll', async () => {
    const mod = await import('@/lib/services/ops-actionable-intake')

    await mod.ingestOpsActionableEvent({
      source: 'cron',
      jobId: 'job_2',
      runAtMs: 1739960100000,
      severity: 'medium',
      summary: 'Disk usage reached threshold',
      recommendation: 'Approve log retention reduction',
      evidenceJson: { diskPct: 92 },
    })

    const firstPoll = await mod.pollAndRelayOpsActionable(10)
    const secondPoll = await mod.pollAndRelayOpsActionable(10)

    expect(firstPoll.items).toHaveLength(1)
    expect(firstPoll.items[0]?.relayedAt).not.toBeNull()
    expect(secondPoll.items).toHaveLength(0)
  })

  it('dedupes within a team scope but not across teams', async () => {
    const mod = await import('@/lib/services/ops-actionable-intake')

    const shared = {
      source: 'cron',
      jobId: 'job_4',
      runAtMs: 1739961100000,
      severity: 'medium',
      summary: 'Dependency mismatch detected',
      recommendation: 'Approve patch deployment',
      evidenceJson: { pointer: 'ops.log#L51' },
    }

    await mod.ingestOpsActionableEvent({ ...shared, teamId: 'team_a' })
    await mod.ingestOpsActionableEvent({ ...shared, teamId: 'team_a' })
    await mod.ingestOpsActionableEvent({ ...shared, teamId: 'team_b' })

    expect(state.events).toHaveLength(2)
    expect(state.workOrders).toHaveLength(2)
  })

  it('ignores NO_ACTION events', async () => {
    const mod = await import('@/lib/services/ops-actionable-intake')

    const result = await mod.ingestOpsActionableEvent({
      source: 'cron',
      jobId: 'job_3',
      summary: 'NO_ACTION',
      recommendation: 'none',
    })

    expect(result.ignored).toBe(true)
    expect(state.events).toHaveLength(0)
    expect(state.workOrders).toHaveLength(0)
  })
})
