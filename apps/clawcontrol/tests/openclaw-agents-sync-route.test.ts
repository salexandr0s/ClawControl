import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  repos: {
    agents: {
      list: vi.fn(),
    },
  },
  syncAgentsFromOpenClaw: vi.fn(),
  reconcileActiveGovernanceProfiles: vi.fn(),
}))

vi.mock('@/lib/repo', () => ({
  getRepos: () => mocks.repos,
}))

vi.mock('@/lib/sync-agents', () => ({
  syncAgentsFromOpenClaw: (...args: unknown[]) => mocks.syncAgentsFromOpenClaw(...args),
}))

vi.mock('@/lib/services/governance-profiles', () => ({
  reconcileActiveGovernanceProfiles: (...args: unknown[]) => mocks.reconcileActiveGovernanceProfiles(...args),
}))

describe('api/openclaw/agents/sync route', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.repos.agents.list.mockReset()
    mocks.syncAgentsFromOpenClaw.mockReset()
    mocks.reconcileActiveGovernanceProfiles.mockReset()

    mocks.repos.agents.list.mockResolvedValue([{ id: 'agent_1', runtimeAgentId: 'main' }])
    mocks.syncAgentsFromOpenClaw.mockResolvedValue({
      added: 1,
      updated: 2,
      stale: 0,
      source: 'cli',
    })
    mocks.reconcileActiveGovernanceProfiles.mockResolvedValue({
      profileIds: [],
      totalMutations: 0,
      results: [],
    })
  })

  it('runs reconciliation after sync and returns agents/stats payload', async () => {
    const route = await import('@/app/api/openclaw/agents/sync/route')

    const response = await route.POST()
    const payload = await response.json() as {
      data: Array<{ id: string }>
      stats: { added: number; updated: number; stale: number; source: string }
    }

    expect(response.status).toBe(200)
    expect(payload.data).toHaveLength(1)
    expect(payload.stats).toMatchObject({
      added: 1,
      updated: 2,
      stale: 0,
      source: 'cli',
    })
    expect(mocks.reconcileActiveGovernanceProfiles).toHaveBeenCalledTimes(1)
    expect(mocks.reconcileActiveGovernanceProfiles).toHaveBeenCalledWith({ apply: true })
  })

  it('keeps sync route successful when reconciliation fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.reconcileActiveGovernanceProfiles.mockRejectedValue(new Error('reconcile failed'))

    const route = await import('@/app/api/openclaw/agents/sync/route')
    const response = await route.POST()
    const payload = await response.json() as {
      data: Array<{ id: string }>
      stats: { added: number; updated: number; stale: number; source: string }
    }

    expect(response.status).toBe(200)
    expect(payload.data).toHaveLength(1)
    expect(payload.stats.source).toBe('cli')

    warnSpy.mockRestore()
  })

  it('returns 502 when OpenClaw sync fails', async () => {
    mocks.syncAgentsFromOpenClaw.mockRejectedValue(new Error('sync down'))

    const route = await import('@/app/api/openclaw/agents/sync/route')
    const response = await route.POST()
    const payload = await response.json() as { error: string; detail: string }

    expect(response.status).toBe(502)
    expect(payload.error).toBe('OPENCLAW_SYNC_FAILED')
    expect(payload.detail).toContain('sync down')
    expect(mocks.reconcileActiveGovernanceProfiles).not.toHaveBeenCalled()
  })
})
