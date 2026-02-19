import { beforeEach, describe, expect, it, vi } from 'vitest'

const runCommandJsonMock = vi.fn()
const getOpenClawConfigMock = vi.fn()

const createdAgents: Array<Record<string, unknown>> = []

vi.mock('@clawcontrol/adapters-openclaw', () => ({
  runCommandJson: (...args: unknown[]) => runCommandJsonMock(...args),
}))

vi.mock('@/lib/openclaw-client', () => ({
  getOpenClawConfig: (...args: unknown[]) => getOpenClawConfigMock(...args),
}))

vi.mock('@/lib/services/governance-profiles', () => ({
  resolveActiveTopologyOwnership: async () => ({
    canonicalTeamId: 'team_1',
    byRuntimeId: new Map([
      ['wf-security', {
        runtimeAgentId: 'wf-security',
        templateId: 'security',
        station: 'security',
        kind: 'worker',
        role: 'SECURITY',
        defaultDisplayName: 'SavorgSecurity',
      }],
    ]),
  }),
  getKnownTopologyEntry: (runtimeAgentId: string) => {
    if (runtimeAgentId !== 'wf-security') return null
    return {
      runtimeAgentId: 'wf-security',
      templateId: 'security',
      station: 'security',
      kind: 'worker',
      role: 'SECURITY',
      defaultDisplayName: 'SavorgSecurity',
    }
  },
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    agent: {
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => ({ id: 'ignored' })),
      findFirst: vi.fn(async () => null),
    },
  },
}))

vi.mock('@/lib/repo', () => ({
  getRepos: () => ({
    stations: {
      getById: async (id: string) => (id === 'ops' ? { id: 'ops' } : null),
      list: async () => [{ id: 'ops' }],
    },
    agentTeams: {
      getBySlug: async (slug: string) => (slug === 'clawcontrol-team' ? { id: 'team_1' } : null),
    },
    agents: {
      getBySessionKey: async () => null,
      getByName: async () => null,
      create: async (input: Record<string, unknown>) => {
        createdAgents.push(input)
        return { id: 'created', ...input }
      },
      update: async () => null,
    },
  }),
}))

describe('syncAgentsFromOpenClaw topology mapping', () => {
  beforeEach(() => {
    runCommandJsonMock.mockReset()
    getOpenClawConfigMock.mockReset()
    createdAgents.length = 0
  })

  it('creates wf-security with security station and security capability', async () => {
    runCommandJsonMock.mockResolvedValue({
      exitCode: 0,
      data: [{ id: 'wf-security', name: 'SavorgSecurity' }],
    })
    getOpenClawConfigMock.mockResolvedValue(null)

    const mod = await import('@/lib/sync-agents')
    const result = await mod.syncAgentsFromOpenClaw({ forceRefresh: true })

    expect(result.added).toBe(1)
    expect(createdAgents).toHaveLength(1)
    expect(createdAgents[0]).toMatchObject({
      runtimeAgentId: 'wf-security',
      station: 'security',
      teamId: 'team_1',
      templateId: 'security',
      capabilities: expect.objectContaining({
        security: true,
      }),
    })
  })
})
