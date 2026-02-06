import 'server-only'

import { getRepos } from '@/lib/repo'
import { getOpenClawConfig } from '@/lib/openclaw-client'
import { buildOpenClawSessionKey, inferDefaultAgentWipLimit, slugifyDisplayName } from '@/lib/agent-identity'

export interface SyncAgentsOptions {
  forceRefresh?: boolean
}

function inferDisplayName(agent: { id: string; identity?: string }): string {
  return agent.identity || agent.id
}

function inferSessionKey(agentId: string): string {
  return buildOpenClawSessionKey(agentId)
}

async function getDefaultStationId(): Promise<string> {
  const repos = getRepos()

  const ops = await repos.stations.getById('ops')
  if (ops) return 'ops'

  const stations = await repos.stations.list()
  return stations[0]?.id ?? 'ops'
}

export async function syncAgentsFromOpenClaw(
  options: SyncAgentsOptions = {}
): Promise<{ added: number; updated: number }> {
  const config = await getOpenClawConfig(Boolean(options.forceRefresh))
  if (!config) {
    throw new Error('OpenClaw config not found at ~/.openclaw/openclaw.json')
  }

  const repos = getRepos()
  const defaultStationId = await getDefaultStationId()

  let added = 0
  let updated = 0

  for (const agent of config.agents) {
    if (!agent?.id) continue

    const name = inferDisplayName(agent)
    const sessionKey = inferSessionKey(agent.id)
    const fallbacks = Array.isArray(agent.fallbacks) ? agent.fallbacks : undefined
    const existing =
      (await repos.agents.getBySessionKey(sessionKey)) ??
      (await repos.agents.getByName(agent.id))

    if (!existing) {
      await repos.agents.create({
        name,
        displayName: name,
        slug: slugifyDisplayName(name),
        runtimeAgentId: agent.id,
        kind: 'worker',
        dispatchEligible: true,
        nameSource: 'openclaw',
        role: 'agent',
        station: defaultStationId,
        sessionKey,
        capabilities: { [defaultStationId]: true },
        wipLimit: inferDefaultAgentWipLimit({
          id: agent.id,
          name,
          station: defaultStationId,
        }),
        ...(agent.model ? { model: agent.model } : {}),
        ...(fallbacks !== undefined ? { fallbacks: JSON.stringify(fallbacks) } : {}),
      })
      added++
    } else {
      await repos.agents.update(existing.id, {
        ...(existing.nameSource === 'user'
          ? {}
          : {
              displayName: name,
              nameSource: 'openclaw',
            }),
        runtimeAgentId: agent.id,
        ...(agent.model ? { model: agent.model } : {}),
        ...(fallbacks !== undefined ? { fallbacks: JSON.stringify(fallbacks) } : {}),
      })
      updated++
    }
  }

  return { added, updated }
}
