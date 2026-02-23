import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  settingFindUnique: vi.fn(),
  settingUpsert: vi.fn(),
  agentFindMany: vi.fn(),
  reconcileOpenClawCompanyTopology: vi.fn(),
  findCanonicalTeamId: vi.fn(),
  listCompanyTopologyEntries: vi.fn(),
  findCompanyTopologyEntry: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    setting: {
      findUnique: (...args: unknown[]) => mocks.settingFindUnique(...args),
      upsert: (...args: unknown[]) => mocks.settingUpsert(...args),
    },
    agent: {
      findMany: (...args: unknown[]) => mocks.agentFindMany(...args),
    },
  },
}))

vi.mock('@/lib/services/openclaw-company-topology-reconcile', () => ({
  reconcileOpenClawCompanyTopology: (...args: unknown[]) => mocks.reconcileOpenClawCompanyTopology(...args),
  findCanonicalTeamId: (...args: unknown[]) => mocks.findCanonicalTeamId(...args),
}))

vi.mock('@/lib/services/openclaw-company-topology-map', () => ({
  MODEL_POLICY: {
    main: 'anthropic/claude-opus-4-6',
    'wf-ops': 'anthropic/claude-sonnet-4-6',
  },
  listCompanyTopologyEntries: (...args: unknown[]) => mocks.listCompanyTopologyEntries(...args),
  findCompanyTopologyEntry: (...args: unknown[]) => mocks.findCompanyTopologyEntry(...args),
}))

describe('governance profile detection', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.settingFindUnique.mockReset()
    mocks.settingUpsert.mockReset()
    mocks.agentFindMany.mockReset()
    mocks.reconcileOpenClawCompanyTopology.mockReset()
    mocks.findCanonicalTeamId.mockReset()
    mocks.listCompanyTopologyEntries.mockReset()
    mocks.findCompanyTopologyEntry.mockReset()

    mocks.settingFindUnique.mockResolvedValue(null)
    mocks.settingUpsert.mockResolvedValue({ key: 'governance.activeProfiles', value: '["clawcontrol-company-v1"]' })
    mocks.agentFindMany.mockResolvedValue([])
    mocks.findCanonicalTeamId.mockResolvedValue(null)
    mocks.findCompanyTopologyEntry.mockReturnValue(null)
    mocks.listCompanyTopologyEntries.mockReturnValue([
      { runtimeAgentId: 'manager' },
      { runtimeAgentId: 'wf-ops' },
      { runtimeAgentId: 'wf-security' },
    ])
  })

  it('auto-activates legacy company profile when topology runtime markers are present', async () => {
    mocks.agentFindMany.mockResolvedValue([
      { runtimeAgentId: 'manager', sessionKey: 'agent:manager:manager' },
      { runtimeAgentId: 'wf-ops', sessionKey: 'agent:wf-ops:wf-ops' },
    ])

    const mod = await import('@/lib/services/governance-profiles')
    const profiles = await mod.getActiveGovernanceProfiles()

    expect(profiles).toEqual([mod.LEGACY_COMPANY_PROFILE_ID])
    expect(mocks.settingUpsert).toHaveBeenCalledTimes(1)
    expect(mocks.agentFindMany).toHaveBeenCalledTimes(1)
  })

  it('does not auto-activate when runtime markers are incomplete', async () => {
    mocks.agentFindMany.mockResolvedValue([
      { runtimeAgentId: 'manager', sessionKey: 'agent:manager:manager' },
    ])

    const mod = await import('@/lib/services/governance-profiles')
    const profiles = await mod.getActiveGovernanceProfiles()

    expect(profiles).toEqual([])
    expect(mocks.settingUpsert).not.toHaveBeenCalled()
  })

  it('respects explicit empty governance profile setting', async () => {
    mocks.settingFindUnique.mockResolvedValue({ value: '[]' })

    const mod = await import('@/lib/services/governance-profiles')
    const profiles = await mod.getActiveGovernanceProfiles()

    expect(profiles).toEqual([])
    expect(mocks.agentFindMany).not.toHaveBeenCalled()
    expect(mocks.settingUpsert).not.toHaveBeenCalled()
  })
})
