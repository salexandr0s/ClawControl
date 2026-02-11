import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getRepos: vi.fn(),
  enforceTypedConfirm: vi.fn(),
  upsertAgentToOpenClaw: vi.fn(),
  repos: {
    agents: {
      getById: vi.fn(),
      update: vi.fn(),
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
  enforceTypedConfirm: mocks.enforceTypedConfirm,
}))

vi.mock('@/lib/services/openclaw-config', () => ({
  upsertAgentToOpenClaw: mocks.upsertAgentToOpenClaw,
}))

describe('agents route station validation', () => {
  beforeEach(() => {
    vi.resetModules()

    mocks.getRepos.mockReset()
    mocks.enforceTypedConfirm.mockReset()
    mocks.upsertAgentToOpenClaw.mockReset()
    mocks.repos.agents.getById.mockReset()
    mocks.repos.agents.update.mockReset()
    mocks.repos.activities.create.mockReset()

    mocks.getRepos.mockReturnValue(mocks.repos)
    mocks.enforceTypedConfirm.mockResolvedValue({ allowed: true })
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
    expect(mocks.enforceTypedConfirm).not.toHaveBeenCalled()
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
})

