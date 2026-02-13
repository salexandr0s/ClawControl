import { beforeEach, describe, expect, it, vi } from 'vitest'

const runCommandJsonMock = vi.fn()
const getOpenClawConfigMock = vi.fn()

const createdAgents: Array<Record<string, unknown>> = []
const updatedAgents: Array<{ id: string; data: Record<string, unknown> }> = []

type ExistingAgent = {
  id: string
  nameSource: 'system' | 'openclaw' | 'user'
  kind: 'worker' | 'manager' | 'ceo' | 'guard'
  role: string
  station: string
  capabilities: Record<string, boolean>
}

const existingBySessionKey = new Map<string, ExistingAgent>()

vi.mock('@clawcontrol/adapters-openclaw', () => ({
  runCommandJson: (...args: unknown[]) => runCommandJsonMock(...args),
}))

vi.mock('@/lib/openclaw-client', () => ({
  getOpenClawConfig: (...args: unknown[]) => getOpenClawConfigMock(...args),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    agent: {
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => ({ id: 'ignored' })),
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
          id: found.id,
          name: sessionKey,
          displayName: sessionKey,
          slug: sessionKey,
          runtimeAgentId: 'main',
          kind: found.kind,
          dispatchEligible: true,
          nameSource: found.nameSource,
          role: found.role,
          station: found.station,
          status: 'idle' as const,
          sessionKey,
          capabilities: found.capabilities,
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
          teamId: null,
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

describe('syncAgentsFromOpenClaw (main CEO promotion)', () => {
  beforeEach(() => {
    runCommandJsonMock.mockReset()
    getOpenClawConfigMock.mockReset()
    createdAgents.length = 0
    updatedAgents.length = 0
    existingBySessionKey.clear()
  })

  it('creates main as CEO on fresh install', async () => {
    runCommandJsonMock.mockResolvedValue({
      exitCode: 0,
      data: [{ id: 'main', name: 'OpenClaw Main' }],
    })

    getOpenClawConfigMock.mockResolvedValue(null)

    const mod = await import('@/lib/sync-agents')
    const result = await mod.syncAgentsFromOpenClaw({ forceRefresh: true })

    expect(result.added).toBe(1)
    expect(createdAgents).toHaveLength(1)

    const created = createdAgents[0] ?? {}
    expect(created.kind).toBe('ceo')
    expect(created.role).toBe('CEO')
    expect(created.station).toBe('strategic')
    expect(created.capabilities).toMatchObject({
      strategic: true,
      can_delegate: true,
      can_send_messages: true,
    })
  })

  it('promotes main on update only when existing record is untouched defaults', async () => {
    runCommandJsonMock.mockResolvedValue({
      exitCode: 0,
      data: [{ id: 'main', name: 'OpenClaw Main' }],
    })

    getOpenClawConfigMock.mockResolvedValue(null)

    existingBySessionKey.set('agent:main:main', {
      id: 'db-main',
      nameSource: 'openclaw',
      kind: 'worker',
      role: 'agent',
      station: 'ops',
      capabilities: { ops: true },
    })

    const mod = await import('@/lib/sync-agents')
    const result = await mod.syncAgentsFromOpenClaw({ forceRefresh: true })

    expect(result.updated).toBe(1)
    expect(updatedAgents).toHaveLength(1)

    const update = updatedAgents[0]?.data ?? {}
    expect(update.kind).toBe('ceo')
    expect(update.role).toBe('CEO')
    expect(update.station).toBe('strategic')
    expect(update.capabilities).toMatchObject({
      ops: true,
      strategic: true,
      can_delegate: true,
      can_send_messages: true,
    })
  })

  it('does not override a customized main agent record', async () => {
    runCommandJsonMock.mockResolvedValue({
      exitCode: 0,
      data: [{ id: 'main', name: 'OpenClaw Main' }],
    })

    getOpenClawConfigMock.mockResolvedValue(null)

    existingBySessionKey.set('agent:main:main', {
      id: 'db-main',
      nameSource: 'user',
      kind: 'worker',
      role: 'CustomCEO',
      station: 'build',
      capabilities: { build: true },
    })

    const mod = await import('@/lib/sync-agents')
    await mod.syncAgentsFromOpenClaw({ forceRefresh: true })

    expect(updatedAgents).toHaveLength(1)
    const update = updatedAgents[0]?.data ?? {}
    expect(update.kind).toBeUndefined()
    expect(update.role).toBeUndefined()
    expect(update.station).toBeUndefined()
    expect(update.capabilities).toBeUndefined()
  })
})

