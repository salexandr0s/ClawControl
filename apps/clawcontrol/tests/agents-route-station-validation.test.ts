import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getRepos: vi.fn(),
  enforceActionPolicy: vi.fn(),
  upsertAgentToOpenClaw: vi.fn(),
  removeAgentFromOpenClaw: vi.fn(),
  verifyOperatorRequest: vi.fn(),
  repos: {
    agents: {
      getById: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    activities: {
      create: vi.fn(),
    },
  },
}))

vi.mock('@/lib/repo', () => ({
  getRepos: mocks.getRepos,
}))

vi.mock('@/lib/with-governor', () => ({
  enforceActionPolicy: mocks.enforceActionPolicy,
}))

vi.mock('@/lib/services/openclaw-config', () => ({
  upsertAgentToOpenClaw: mocks.upsertAgentToOpenClaw,
  removeAgentFromOpenClaw: mocks.removeAgentFromOpenClaw,
}))

vi.mock('@/lib/auth/operator-auth', () => ({
  verifyOperatorRequest: mocks.verifyOperatorRequest,
  asAuthErrorResponse: (result: { error: string; code: string }) => ({
    error: result.error,
    code: result.code,
  }),
}))

describe('agents route station validation', () => {
  beforeEach(() => {
    vi.resetModules()

    mocks.getRepos.mockReset()
    mocks.enforceActionPolicy.mockReset()
    mocks.upsertAgentToOpenClaw.mockReset()
    mocks.removeAgentFromOpenClaw.mockReset()
    mocks.verifyOperatorRequest.mockReset()
    mocks.repos.agents.getById.mockReset()
    mocks.repos.agents.update.mockReset()
    mocks.repos.agents.delete.mockReset()
    mocks.repos.activities.create.mockReset()

    mocks.getRepos.mockReturnValue(mocks.repos)
    mocks.enforceActionPolicy.mockResolvedValue({ allowed: true })
    mocks.verifyOperatorRequest.mockReturnValue({
      ok: true,
      principal: {
        actor: 'user:operator',
        actorType: 'user',
        actorId: 'operator',
        sessionId: 'sess_test',
      },
    })
    mocks.removeAgentFromOpenClaw.mockResolvedValue({ ok: true, removed: true, restartNeeded: true })
    mocks.repos.agents.getById.mockResolvedValue({
      id: 'agent_1',
      name: 'Agent One',
      status: 'idle',
      runtimeAgentId: 'agent-one',
      slug: 'agent-one',
      displayName: 'Agent One',
      sessionKey: 'agent:agent-one:main',
      model: 'claude-sonnet-4-20250514',
      fallbacks: '[]',
    })
    mocks.repos.agents.delete.mockResolvedValue(true)
    mocks.repos.agents.update.mockResolvedValue({
      id: 'agent_1',
      name: 'Agent One',
      status: 'idle',
      role: 'BUILD',
      station: 'ops',
      runtimeAgentId: 'agent-one',
      slug: 'agent-one',
      displayName: 'Agent One',
      sessionKey: 'agent:agent-one:main',
      model: 'claude-sonnet-4-20250514',
      fallbacks: '[]',
    })
  })

  it('rejects non-canonical station values', async () => {
    const route = await import('@/app/api/agents/[id]/route')
    const request = new NextRequest('http://localhost/api/agents/agent_1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        station: 'random-station',
        typedConfirmText: 'CONFIRM',
      }),
    })

    const response = await route.PATCH(request, {
      params: Promise.resolve({ id: 'agent_1' }),
    })
    const payload = (await response.json()) as { error?: string; message?: string }

    expect(response.status).toBe(400)
    expect(payload.error).toBe('INVALID_STATION')
    expect(payload.message).toContain('not canonical')
    expect(mocks.enforceActionPolicy).not.toHaveBeenCalled()
    expect(mocks.repos.agents.update).not.toHaveBeenCalled()
  })

  it('normalizes canonical station values before update', async () => {
    const route = await import('@/app/api/agents/[id]/route')
    const request = new NextRequest('http://localhost/api/agents/agent_1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        station: 'OPS',
        typedConfirmText: 'CONFIRM',
      }),
    })

    const response = await route.PATCH(request, {
      params: Promise.resolve({ id: 'agent_1' }),
    })
    const payload = (await response.json()) as { data: { station: string } }

    expect(response.status).toBe(200)
    expect(payload.data.station).toBe('ops')
    expect(mocks.repos.agents.update).toHaveBeenCalledWith(
      'agent_1',
      expect.objectContaining({ station: 'ops' })
    )
  })

  it('deletes non-main agents via DELETE route', async () => {
    const route = await import('@/app/api/agents/[id]/route')
    const request = new NextRequest('http://localhost/api/agents/agent_1', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ typedConfirmText: 'CONFIRM' }),
    })

    const response = await route.DELETE(request, {
      params: Promise.resolve({ id: 'agent_1' }),
    })
    const payload = (await response.json()) as { success: boolean; data: { id: string } }

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.data.id).toBe('agent_1')
    expect(mocks.enforceActionPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ actionKind: 'agent.delete' })
    )
    expect(mocks.repos.agents.delete).toHaveBeenCalledWith('agent_1')
  })

  it('blocks deleting main agent', async () => {
    mocks.repos.agents.getById.mockResolvedValueOnce({
      id: 'agent_main',
      name: 'main',
      displayName: 'main',
      slug: 'main',
      runtimeAgentId: 'main',
      status: 'idle',
      role: 'CEO',
      station: 'strategic',
      sessionKey: 'agent:main:main',
      capabilities: {},
      wipLimit: 2,
      model: 'claude-sonnet-4-20250514',
      fallbacks: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSeenAt: null,
      lastHeartbeatAt: null,
      dispatchEligible: true,
      kind: 'ceo',
      nameSource: 'openclaw',
      teamId: null,
      templateId: null,
      avatarPath: null,
      isStale: false,
      staleAt: null,
    })

    const route = await import('@/app/api/agents/[id]/route')
    const request = new NextRequest('http://localhost/api/agents/agent_main', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ typedConfirmText: 'CONFIRM' }),
    })

    const response = await route.DELETE(request, {
      params: Promise.resolve({ id: 'agent_main' }),
    })
    const payload = (await response.json()) as { code?: string; error: string }

    expect(response.status).toBe(409)
    expect(payload.code).toBe('AGENT_MAIN_PROTECTED')
    expect(mocks.repos.agents.delete).not.toHaveBeenCalled()
  })
})
