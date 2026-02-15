import { describe, expect, it, vi } from 'vitest'
import { resolveWorkflowStageAgent } from '@/lib/services/agent-resolution'

function makeClient(input: {
  agents: Array<{
    id: string
    name: string
    displayName?: string | null
    slug?: string | null
    runtimeAgentId?: string | null
    kind?: string
    dispatchEligible?: boolean
    role: string
    station: string
    status?: string
    sessionKey: string
    capabilities: Record<string, unknown>
    wipLimit?: number
  }>
}) {
  const agentRows = input.agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    displayName: agent.displayName ?? null,
    slug: agent.slug ?? agent.name.toLowerCase(),
    runtimeAgentId: agent.runtimeAgentId ?? null,
    kind: agent.kind ?? 'worker',
    dispatchEligible: agent.dispatchEligible ?? true,
    role: agent.role,
    station: agent.station,
    status: agent.status ?? 'idle',
    sessionKey: agent.sessionKey,
    capabilities: JSON.stringify(agent.capabilities),
    wipLimit: agent.wipLimit ?? 2,
  }))

  return {
    agent: {
      findMany: vi.fn(async () => agentRows),
      findFirst: vi.fn(async () => agentRows[0] ?? null),
    },
    operation: {
      findMany: vi.fn(async () => []),
    },
    agentSession: {
      findMany: vi.fn(async () => []),
    },
  }
}

describe('resolveWorkflowStageAgent', () => {
  it('requires a dedicated security specialist for security stage', async () => {
    const client = makeClient({
      agents: [
        {
          id: 'a1',
          name: 'QA Agent',
          role: 'QA',
          station: 'qa',
          sessionKey: 'agent:qa:main',
          capabilities: { qa: true },
        },
        {
          id: 'a2',
          name: 'Security Agent',
          role: 'QA',
          station: 'security',
          sessionKey: 'agent:security:main',
          capabilities: { security: true },
        },
      ],
    })

    const resolved = await resolveWorkflowStageAgent(client as any, 'security')
    expect(resolved?.id).toBe('a2')
    expect(resolved?.station.toLowerCase()).toBe('security')
  })

  it('prefers ui specialist over build specialist for ui stage when both are station=build', async () => {
    const client = makeClient({
      agents: [
        {
          id: 'b1',
          name: 'Build Agent',
          role: 'BUILD',
          station: 'build',
          sessionKey: 'agent:build:main',
          capabilities: { build: true },
        },
        {
          id: 'u1',
          name: 'UI Agent',
          role: 'BUILD',
          station: 'build',
          sessionKey: 'agent:ui:main',
          capabilities: { ui: true },
        },
      ],
    })

    const resolved = await resolveWorkflowStageAgent(client as any, 'ui')
    expect(resolved?.id).toBe('u1')
  })
})

