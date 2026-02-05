import 'server-only'

import { getRepos } from '@/lib/repo'
import { getOpenClawConfig } from '@/lib/openclaw-client'

function inferDisplayName(agent: { id: string; identity?: string }): string {
  return agent.identity || agent.id
}

function inferSessionKey(agentId: string): string {
  // Matches OpenClaw session key convention for agent stores.
  // main is special because it's typically agent:main:main
  if (agentId === 'main') return 'agent:main:main'
  return `agent:${agentId}:${agentId}`
}

async function getDefaultStationId(): Promise<string> {
  const repos = getRepos()

  const ops = await repos.stations.getById('ops')
  if (ops) return 'ops'

  const stations = await repos.stations.list()
  return stations[0]?.id ?? 'ops'
}

export async function syncAgentsFromOpenClaw(): Promise<{ added: number; updated: number }> {
  const config = await getOpenClawConfig()
  if (!config) return { added: 0, updated: 0 }

  const repos = getRepos()
  const defaultStationId = await getDefaultStationId()

  let added = 0
  let updated = 0

  for (const agent of config.agents) {
    if (!agent?.id) continue

    const name = inferDisplayName(agent)
    const sessionKey = inferSessionKey(agent.id)
    const existing = await repos.agents.getBySessionKey(sessionKey)

    if (!existing) {
      await repos.agents.create({
        name,
        role: 'agent',
        station: defaultStationId,
        sessionKey,
        capabilities: { [defaultStationId]: true },
        wipLimit: agent.id === 'clawbuild' ? 3 : 2,
      })
      added++
    } else {
      await repos.agents.update(existing.id, {
        name,
        ...(agent.model ? { model: agent.model } : {}),
      })
      updated++
    }
  }

  return { added, updated }
}

