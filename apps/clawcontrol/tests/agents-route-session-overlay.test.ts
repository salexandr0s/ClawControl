import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { AgentDTO } from '@/lib/repo'

const mocks = vi.hoisted(() => ({
  repos: {
    agents: {
      list: vi.fn(),
    },
  },
  agentSessionFindMany: vi.fn(),
  getOrLoadWithCache: vi.fn(),
  syncAgentSessions: vi.fn(),
  isFirstRun: vi.fn(),
  syncAgentsFromOpenClaw: vi.fn(),
  getOpenClawConfig: vi.fn(),
}))

vi.mock('@/lib/repo', () => ({
  getRepos: () => mocks.repos,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    agentSession: {
      findMany: (...args: unknown[]) => mocks.agentSessionFindMany(...args),
    },
  },
}))

vi.mock('@/lib/first-run', () => ({
  isFirstRun: (...args: unknown[]) => mocks.isFirstRun(...args),
}))

vi.mock('@/lib/sync-agents', () => ({
  syncAgentsFromOpenClaw: (...args: unknown[]) => mocks.syncAgentsFromOpenClaw(...args),
}))

vi.mock('@/lib/openclaw-client', () => ({
  getOpenClawConfig: (...args: unknown[]) => mocks.getOpenClawConfig(...args),
}))

vi.mock('@/lib/openclaw/sessions', () => ({
  syncAgentSessions: (...args: unknown[]) => mocks.syncAgentSessions(...args),
}))

vi.mock('@/lib/perf/route-timing', () => ({
  withRouteTiming: (_name: string, handler: unknown) => handler,
}))

vi.mock('@/lib/perf/async-cache', () => ({
  getOrLoadWithCache: (...args: unknown[]) => mocks.getOrLoadWithCache(...args),
}))

function makeAgent(overrides: Partial<AgentDTO> = {}): AgentDTO {
  const now = new Date('2026-02-18T12:00:00.000Z')
  return {
    id: 'agent_main',
    name: 'SavorgBot',
    displayName: 'SavorgBot',
    slug: 'main',
    runtimeAgentId: 'main',
    templateId: null,
    kind: 'ceo',
    dispatchEligible: true,
    nameSource: 'openclaw',
    role: 'CEO',
    station: 'strategic',
    teamId: null,
    status: 'idle',
    sessionKey: 'agent:main:main',
    capabilities: { strategic: true },
    wipLimit: 2,
    avatarPath: null,
    model: 'openai-codex/gpt-5.3-codex',
    fallbacks: [],
    isStale: false,
    staleAt: null,
    lastSeenAt: null,
    lastHeartbeatAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('api/agents session overlay', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-18T12:00:00.000Z'))

    vi.resetModules()
    mocks.repos.agents.list.mockReset()
    mocks.agentSessionFindMany.mockReset()
    mocks.getOrLoadWithCache.mockReset()
    mocks.syncAgentSessions.mockReset()
    mocks.isFirstRun.mockReset()
    mocks.syncAgentsFromOpenClaw.mockReset()
    mocks.getOpenClawConfig.mockReset()

    mocks.isFirstRun.mockResolvedValue(false)
    mocks.getOpenClawConfig.mockResolvedValue(null)
    mocks.syncAgentSessions.mockResolvedValue({ seen: 0, upserted: 0 })
    mocks.getOrLoadWithCache.mockImplementation(async (_key: string, _ttlMs: number, loader: () => Promise<unknown>) => ({
      value: await loader(),
      cacheHit: false,
      sharedInFlight: false,
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('downgrades stale active telemetry to idle and hydrates heartbeat', async () => {
    const staleSeenAt = new Date('2026-02-18T11:53:00.000Z') // 7m stale
    mocks.repos.agents.list.mockResolvedValue([makeAgent({ status: 'active' })])
    mocks.agentSessionFindMany.mockResolvedValue([
      { agentId: 'main', state: 'active', lastSeenAt: staleSeenAt },
    ])

    const route = await import('@/app/api/agents/route')
    const request = new NextRequest(
      'http://localhost/api/agents?includeSessionOverlay=1&syncSessions=0&includeModelOverlay=0'
    )
    const response = await route.GET(request)
    const payload = await response.json() as { data: Array<{ status: string; lastHeartbeatAt: string }> }

    expect(payload.data[0]?.status).toBe('idle')
    expect(new Date(payload.data[0]?.lastHeartbeatAt).toISOString()).toBe(staleSeenAt.toISOString())
  })

  it('keeps fresh active telemetry as active', async () => {
    const freshSeenAt = new Date('2026-02-18T11:58:30.000Z')
    mocks.repos.agents.list.mockResolvedValue([makeAgent({ status: 'idle' })])
    mocks.agentSessionFindMany.mockResolvedValue([
      { agentId: 'main', state: 'active', lastSeenAt: freshSeenAt },
    ])

    const route = await import('@/app/api/agents/route')
    const request = new NextRequest(
      'http://localhost/api/agents?includeSessionOverlay=1&syncSessions=0&includeModelOverlay=0'
    )
    const response = await route.GET(request)
    const payload = await response.json() as { data: Array<{ status: string }> }

    expect(payload.data[0]?.status).toBe('active')
  })

  it('falls back to idle when no telemetry rows exist for an active agent', async () => {
    mocks.repos.agents.list.mockResolvedValue([makeAgent({ status: 'active' })])
    mocks.agentSessionFindMany.mockResolvedValue([])

    const route = await import('@/app/api/agents/route')
    const request = new NextRequest(
      'http://localhost/api/agents?includeSessionOverlay=1&syncSessions=0&includeModelOverlay=0'
    )
    const response = await route.GET(request)
    const payload = await response.json() as { data: Array<{ status: string }> }

    expect(payload.data[0]?.status).toBe('idle')
  })

  it('hydrates heartbeat from freshest telemetry even when status is resolved by higher-priority state', async () => {
    const errorSeenAt = new Date('2026-02-18T11:58:00.000Z')
    const freshestSeenAt = new Date('2026-02-18T11:59:30.000Z')
    mocks.repos.agents.list.mockResolvedValue([makeAgent({ status: 'idle' })])
    mocks.agentSessionFindMany.mockResolvedValue([
      { agentId: 'main', state: 'error', lastSeenAt: errorSeenAt },
      { agentId: 'main', state: 'idle', lastSeenAt: freshestSeenAt },
    ])

    const route = await import('@/app/api/agents/route')
    const request = new NextRequest(
      'http://localhost/api/agents?includeSessionOverlay=1&syncSessions=0&includeModelOverlay=0'
    )
    const response = await route.GET(request)
    const payload = await response.json() as {
      data: Array<{ status: string; lastHeartbeatAt: string; lastSeenAt: string }>
    }

    expect(payload.data[0]?.status).toBe('error')
    expect(new Date(payload.data[0]?.lastHeartbeatAt).toISOString()).toBe(freshestSeenAt.toISOString())
    expect(new Date(payload.data[0]?.lastSeenAt).toISOString()).toBe(freshestSeenAt.toISOString())
  })
})
