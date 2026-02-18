import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { AgentDTO, OperationDTO } from '@/lib/repo'

const mockAgentsList = vi.fn()
const mockOperationsList = vi.fn()

vi.mock('@/lib/http', () => ({
  agentsApi: {
    list: mockAgentsList,
  },
  operationsApi: {
    list: mockOperationsList,
  },
}))

describe('agents-tab-store', () => {
  beforeEach(async () => {
    vi.useRealTimers()
    mockAgentsList.mockReset()
    mockOperationsList.mockReset()
    vi.resetModules()

    const mod = await import('@/lib/stores/agents-tab-store')
    mod.resetAgentsTabCacheForTests()
  })

  it('returns cached data when snapshot is fresh', async () => {
    const mod = await import('@/lib/stores/agents-tab-store')
    const cachedAgents = [
      { id: 'a-1', displayName: 'Agent One' },
    ] as unknown as AgentDTO[]
    const cachedOps = [
      { id: 'op-1', assigneeAgentIds: ['a-1'] },
    ] as unknown as OperationDTO[]

    mod.useAgentsTabStore.setState({
      agents: cachedAgents,
      operations: cachedOps,
      fetchedAt: Date.now(),
      isLoading: false,
      isRefreshing: false,
      error: null,
    })

    const result = await mod.revalidateAgentsTabCache({ force: false })

    expect(result.agents).toEqual(cachedAgents)
    expect(result.operations).toEqual(cachedOps)
    expect(mockAgentsList).not.toHaveBeenCalled()
    expect(mockOperationsList).not.toHaveBeenCalled()
  })

  it('revalidates stale snapshots once and dedupes in-flight requests', async () => {
    const mod = await import('@/lib/stores/agents-tab-store')
    const staleAgents = [
      { id: 'a-stale', displayName: 'Stale' },
    ] as unknown as AgentDTO[]
    const staleOps = [
      { id: 'op-stale', assigneeAgentIds: ['a-stale'] },
    ] as unknown as OperationDTO[]
    const freshAgents = [
      { id: 'a-fresh', displayName: 'Fresh' },
    ] as unknown as AgentDTO[]
    const freshOps = [
      { id: 'op-fresh', assigneeAgentIds: ['a-fresh'] },
    ] as unknown as OperationDTO[]

    mod.useAgentsTabStore.setState({
      agents: staleAgents,
      operations: staleOps,
      fetchedAt: Date.now() - mod.AGENTS_TAB_STALE_TIME_MS - 1,
      isLoading: false,
      isRefreshing: false,
      error: null,
    })

    let resolveAgents!: (value: { data: AgentDTO[] }) => void
    let resolveOps!: (value: { data: OperationDTO[] }) => void

    mockAgentsList.mockImplementation(
      () => new Promise<{ data: AgentDTO[] }>((resolve) => {
        resolveAgents = resolve
      })
    )
    mockOperationsList.mockImplementation(
      () => new Promise<{ data: OperationDTO[] }>((resolve) => {
        resolveOps = resolve
      })
    )

    const requestA = mod.revalidateAgentsTabCache({ force: false, blocking: false })
    const requestB = mod.revalidateAgentsTabCache({ force: false, blocking: false })

    expect(mockAgentsList).toHaveBeenCalledTimes(1)
    expect(mockAgentsList).toHaveBeenCalledWith({
      mode: 'light',
      includeSessionOverlay: true,
      includeModelOverlay: true,
      syncSessions: true,
      cacheTtlMs: 5000,
    })
    expect(mockOperationsList).toHaveBeenCalledTimes(1)

    resolveAgents({ data: freshAgents })
    resolveOps({ data: freshOps })

    const [resultA, resultB] = await Promise.all([requestA, requestB])
    expect(resultA).toEqual({ agents: freshAgents, operations: freshOps })
    expect(resultB).toEqual({ agents: freshAgents, operations: freshOps })

    const state = mod.useAgentsTabStore.getState()
    expect(state.agents).toEqual(freshAgents)
    expect(state.operations).toEqual(freshOps)
    expect(state.fetchedAt).not.toBeNull()
    expect(state.isLoading).toBe(false)
    expect(state.isRefreshing).toBe(false)
  })
})
