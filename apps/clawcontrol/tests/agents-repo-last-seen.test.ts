import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFindUnique = vi.fn()
const mockUpdate = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    agent: {
      findUnique: mockFindUnique,
      update: mockUpdate,
      findMany: vi.fn(),
    },
  },
}))

function makeAgentRow(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-02-07T10:00:00.000Z')
  return {
    id: 'agent-1',
    name: 'Agent One',
    displayName: 'Agent One',
    slug: 'agent-one',
    runtimeAgentId: 'agentone',
    kind: 'worker',
    dispatchEligible: true,
    nameSource: 'system',
    role: 'agent',
    station: 'ops',
    status: 'idle',
    sessionKey: 'agent:agentone:agentone',
    capabilities: '{}',
    wipLimit: 2,
    avatarPath: null,
    model: 'anthropic/claude-sonnet-4-5',
    fallbacks: '[]',
    lastSeenAt: new Date('2026-02-07T09:00:00.000Z'),
    lastHeartbeatAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('agents repo lastSeenAt update behavior', () => {
  beforeEach(() => {
    mockFindUnique.mockReset()
    mockUpdate.mockReset()
    vi.resetModules()
  })

  it('does not modify lastSeenAt for metadata-only updates', async () => {
    const existing = makeAgentRow()
    mockFindUnique.mockResolvedValue(existing)
    mockUpdate.mockResolvedValue(makeAgentRow({ role: 'planner' }))

    const { createDbAgentsRepo } = await import('@/lib/repo/agents')
    const repo = createDbAgentsRepo()
    await repo.update(existing.id, { role: 'planner' })

    expect(mockUpdate).toHaveBeenCalledTimes(1)
    const updateInput = mockUpdate.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    expect(updateInput.data.role).toBe('planner')
    expect(updateInput.data).not.toHaveProperty('lastSeenAt')
  })

  it('touches lastSeenAt when status is set to active', async () => {
    const existing = makeAgentRow()
    mockFindUnique.mockResolvedValue(existing)
    mockUpdate.mockResolvedValue(makeAgentRow({ status: 'active' }))

    const { createDbAgentsRepo } = await import('@/lib/repo/agents')
    const repo = createDbAgentsRepo()
    await repo.update(existing.id, { status: 'active' })

    expect(mockUpdate).toHaveBeenCalledTimes(1)
    const updateInput = mockUpdate.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    expect(updateInput.data.status).toBe('active')
    expect(updateInput.data.lastSeenAt).toBeInstanceOf(Date)
  })
})
