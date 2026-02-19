import { beforeEach, describe, expect, it, vi } from 'vitest'

const runCommandJsonMock = vi.fn()
const getOpenClawConfigMock = vi.fn()

const createdAgents: Array<Record<string, unknown>> = []
const updatedAgents: Array<{ id: string; data: Record<string, unknown> }> = []
const staleUpdates: Array<{ id: string; data: Record<string, unknown> }> = []

const existingBySessionKey = new Map<string, {
  id: string
  nameSource: 'system' | 'openclaw' | 'user'
}>()

vi.mock('@clawcontrol/adapters-openclaw', () => ({
  runCommandJson: (...args: unknown[]) => runCommandJsonMock(...args),
}))

vi.mock('@/lib/openclaw-client', () => ({
  getOpenClawConfig: (...args: unknown[]) => getOpenClawConfigMock(...args),
}))

vi.mock('@/lib/services/governance-profiles', () => ({
  resolveActiveTopologyOwnership: async () => ({
    canonicalTeamId: null,
    byRuntimeId: new Map(),
  }),
  getKnownTopologyEntry: () => null,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    agent: {
      findMany: vi.fn(async () => [
        { id: 'db-seen', sessionKey: 'agent:seen-agent:seen-agent' },
        { id: 'db-missing', sessionKey: 'agent:missing-agent:missing-agent' },
      ]),
      update: vi.fn(async ({ where, data }) => {
        staleUpdates.push({ id: where.id as string, data: data as Record<string, unknown> })
        return { id: where.id, ...data }
      }),
    },
  },
}))

vi.mock('@/lib/repo', () => ({
  getRepos: () => ({
    stations: {
      getById: async (id: string) => (id === 'ops' ? { id: 'ops' } : null),
      list: async () => [{ id: 'ops' }],
    },
    agents: {
      getBySessionKey: async (sessionKey: string) => {
        const found = existingBySessionKey.get(sessionKey)
        if (!found) return null
        return {
          ...found,
          name: sessionKey,
          displayName: sessionKey,
          slug: sessionKey,
          runtimeAgentId: sessionKey,
          kind: 'worker' as const,
          dispatchEligible: true,
          role: 'agent',
          station: 'ops',
          status: 'idle' as const,
          sessionKey,
          capabilities: { ops: true },
          wipLimit: 2,
          avatarPath: null,
          model: null,
          fallbacks: [],
          isStale: false,
          staleAt: null,
          lastSeenAt: null,
          lastHeartbeatAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      },
      getByName: async () => null,
      create: async (input: Record<string, unknown>) => {
        createdAgents.push(input)
        return {
          id: 'created',
          ...input,
        }
      },
      update: async (id: string, input: Record<string, unknown>) => {
        updatedAgents.push({ id, data: input })
        return {
          id,
          ...input,
        }
      },
    },
  }),
}))

describe('syncAgentsFromOpenClaw', () => {
  beforeEach(() => {
    runCommandJsonMock.mockReset()
    getOpenClawConfigMock.mockReset()
    createdAgents.length = 0
    updatedAgents.length = 0
    staleUpdates.length = 0
    existingBySessionKey.clear()

    existingBySessionKey.set('agent:seen-agent:seen-agent', {
      id: 'db-seen',
      nameSource: 'openclaw',
    })
  })

  it('uses CLI-first discovery and marks missing agents as stale instead of pruning', async () => {
    runCommandJsonMock.mockResolvedValue({
      exitCode: 0,
      data: [
        { id: 'seen-agent', name: 'Seen Agent' },
      ],
    })

    getOpenClawConfigMock.mockResolvedValue(null)

    const mod = await import('@/lib/sync-agents')
    const result = await mod.syncAgentsFromOpenClaw({ forceRefresh: true })

    expect(result.source).toBe('cli')
    expect(result.added).toBe(0)
    expect(result.updated).toBe(1)
    expect(result.stale).toBe(1)

    expect(updatedAgents[0]?.id).toBe('db-seen')
    expect(updatedAgents[0]?.data?.isStale).toBe(false)
    expect(updatedAgents[0]?.data?.staleAt).toBeNull()

    expect(staleUpdates).toHaveLength(1)
    expect(staleUpdates[0]?.id).toBe('db-missing')
    expect(staleUpdates[0]?.data?.isStale).toBe(true)
  })
})
