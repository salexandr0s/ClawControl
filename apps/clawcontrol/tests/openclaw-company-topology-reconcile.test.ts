import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  repos: {
    agentTeams: {
      getBySlug: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    agents: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
  agentFindFirst: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mocks.readFile(...args),
}))

vi.mock('@/lib/repo', () => ({
  getRepos: () => mocks.repos,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    agent: {
      findFirst: (...args: unknown[]) => mocks.agentFindFirst(...args),
    },
  },
}))

describe('openclaw company topology reconcile', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.readFile.mockReset()
    mocks.repos.agentTeams.getBySlug.mockReset()
    mocks.repos.agentTeams.create.mockReset()
    mocks.repos.agentTeams.update.mockReset()
    mocks.repos.agents.create.mockReset()
    mocks.repos.agents.update.mockReset()
    mocks.agentFindFirst.mockReset()

    mocks.readFile.mockRejectedValue(new Error('ENOENT'))
    mocks.repos.agentTeams.getBySlug.mockResolvedValue(null)
    mocks.agentFindFirst.mockResolvedValue(null)
  })

  it('uses built-in starter team fallback when starter-pack yaml is missing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mod = await import('@/lib/services/openclaw-company-topology-reconcile')

    const result = await mod.reconcileOpenClawCompanyTopology({ apply: false })

    expect(result.team.id).toBe('clawcontrol-team')
    expect(result.team.created).toBe(true)
    expect(result.stageCoverage.ok).toBe(true)
    expect(result.agents.created).toBeGreaterThan(0)
    expect(mocks.repos.agentTeams.create).not.toHaveBeenCalled()
    expect(mocks.repos.agents.create).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()

    warnSpy.mockRestore()
  })
})
