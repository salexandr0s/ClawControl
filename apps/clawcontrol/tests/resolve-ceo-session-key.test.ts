import { describe, expect, it } from 'vitest'

import { resolveCeoSessionKey } from '@/lib/services/agent-resolution'

function makeClient(input: {
  agents: Array<{
    id: string
    name: string
    displayName?: string | null
    slug?: string | null
    runtimeAgentId?: string | null
    kind: string
    dispatchEligible: boolean
    role: string
    station: string
    status: string
    sessionKey: string
    capabilities: string
    wipLimit: number
  }>
}) {
  return {
    agent: {
      findMany: async () => input.agents,
    },
    operation: {
      findMany: async () => [],
    },
    agentSession: {
      findMany: async () => [],
    },
  } as any
}

describe('resolveCeoSessionKey', () => {
  it('prefers OpenClaw main agent when available', async () => {
    const client = makeClient({
      agents: [
        {
          id: 'a_main',
          name: 'Main',
          displayName: 'Main',
          slug: 'main',
          runtimeAgentId: 'main',
          kind: 'worker',
          dispatchEligible: true,
          role: 'agent',
          station: 'ops',
          status: 'idle',
          sessionKey: 'agent:main:main',
          capabilities: JSON.stringify({ ops: true }),
          wipLimit: 2,
        },
        {
          id: 'a_ceo',
          name: 'CEO',
          displayName: 'CEO',
          slug: 'ceo',
          runtimeAgentId: 'ceo',
          kind: 'ceo',
          dispatchEligible: true,
          role: 'CEO',
          station: 'strategic',
          status: 'idle',
          sessionKey: 'agent:ceo:ceo',
          capabilities: JSON.stringify({ strategic: true, can_delegate: true, can_send_messages: true }),
          wipLimit: 1,
        },
      ],
    })

    const resolved = await resolveCeoSessionKey(client)
    expect(resolved).toBe('agent:main:main')
  })

  it('falls back to scoring when main is absent', async () => {
    const client = makeClient({
      agents: [
        {
          id: 'a_ceo',
          name: 'CEO',
          displayName: 'CEO',
          slug: 'ceo',
          runtimeAgentId: 'ceo',
          kind: 'ceo',
          dispatchEligible: true,
          role: 'CEO',
          station: 'strategic',
          status: 'idle',
          sessionKey: 'agent:ceo:ceo',
          capabilities: JSON.stringify({ strategic: true, can_delegate: true, can_send_messages: true }),
          wipLimit: 1,
        },
        {
          id: 'a_worker',
          name: 'Worker',
          displayName: 'Worker',
          slug: 'worker',
          runtimeAgentId: 'worker',
          kind: 'worker',
          dispatchEligible: true,
          role: 'agent',
          station: 'ops',
          status: 'idle',
          sessionKey: 'agent:worker:worker',
          capabilities: JSON.stringify({ ops: true }),
          wipLimit: 2,
        },
      ],
    })

    const resolved = await resolveCeoSessionKey(client)
    expect(resolved).toBe('agent:ceo:ceo')
  })
})

