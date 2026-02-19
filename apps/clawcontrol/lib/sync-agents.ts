import 'server-only'

import { runCommandJson } from '@clawcontrol/adapters-openclaw'
import { getRepos } from '@/lib/repo'
import { prisma } from '@/lib/db'
import { getOpenClawConfig } from '@/lib/openclaw-client'
import { buildOpenClawSessionKey, inferDefaultAgentWipLimit, slugifyDisplayName } from '@/lib/agent-identity'
import {
  buildTemplateBaselineCapabilities,
} from '@/lib/services/openclaw-company-topology-map'
import {
  getKnownTopologyEntry,
  resolveActiveTopologyOwnership,
} from '@/lib/services/governance-profiles'

export interface SyncAgentsOptions {
  forceRefresh?: boolean
}

export interface SyncAgentsResult {
  added: number
  updated: number
  stale: number
  source: 'cli' | 'config'
}

interface OpenClawAgentConfig {
  id: string
  identity?: string
  name?: string
  model?: string
  fallbacks?: string[]
}

function inferDisplayName(agent: OpenClawAgentConfig): string {
  return agent.identity || agent.name || agent.id
}

function inferSessionKey(agentId: string): string {
  return buildOpenClawSessionKey(agentId)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined

  const normalized = value
    .map((item) => asString(item))
    .filter((item): item is string => Boolean(item))

  return normalized
}

function extractModel(value: unknown): { model?: string; fallbacks?: string[] } {
  if (typeof value === 'string') {
    const model = asString(value)
    return model ? { model } : {}
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const record = value as Record<string, unknown>
  const model =
    asString(record.primary)
    || asString(record.model)
    || asString(record.id)
    || asString(record.key)

  const fallbacks = asStringArray(record.fallbacks) ?? []

  return {
    ...(model ? { model } : {}),
    ...(record.fallbacks !== undefined ? { fallbacks } : {}),
  }
}

function normalizeAgentRecord(input: unknown): OpenClawAgentConfig | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null

  const record = input as Record<string, unknown>
  const id = asString(record.id)
  if (!id) return null

  const identity =
    asString(record.identity)
    || asString((record.identity as Record<string, unknown> | undefined)?.name)
    || asString(record.name)

  const modelConfig = extractModel(record.model)

  return {
    id,
    ...(identity ? { identity } : {}),
    ...(modelConfig.model ? { model: modelConfig.model } : {}),
    ...(modelConfig.fallbacks !== undefined ? { fallbacks: modelConfig.fallbacks } : {}),
  }
}

function normalizeCliPayload(payload: unknown): OpenClawAgentConfig[] {
  if (Array.isArray(payload)) {
    return payload
      .map((entry) => normalizeAgentRecord(entry))
      .filter((entry): entry is OpenClawAgentConfig => Boolean(entry))
  }

  if (!payload || typeof payload !== 'object') return []

  const record = payload as Record<string, unknown>
  const list =
    (Array.isArray(record.agents) ? record.agents : null)
    || (Array.isArray(record.list) ? record.list : null)
    || []

  return list
    .map((entry) => normalizeAgentRecord(entry))
    .filter((entry): entry is OpenClawAgentConfig => Boolean(entry))
}

async function discoverAgents(forceRefresh: boolean): Promise<{ agents: OpenClawAgentConfig[]; source: 'cli' | 'config' }> {
  const cliResult = await runCommandJson<unknown>('config.agents.list.json')
  if (!cliResult.error && cliResult.data) {
    const agents = normalizeCliPayload(cliResult.data)
    return { agents, source: 'cli' }
  }

  const config = await getOpenClawConfig(forceRefresh)
  if (!config) {
    throw new Error('OpenClaw config not found in CLI output, settings, or local config files')
  }

  const agents: OpenClawAgentConfig[] = []
  for (const agent of config.agents) {
    if (!agent?.id) continue
    agents.push({
      id: agent.id,
      ...(agent.identity ? { identity: agent.identity } : {}),
      ...(agent.model ? { model: agent.model } : {}),
      ...(Array.isArray(agent.fallbacks) ? { fallbacks: agent.fallbacks } : {}),
    })
  }

  return {
    agents,
    source: 'config',
  }
}

async function getDefaultStationId(): Promise<string> {
  const repos = getRepos()

  const ops = await repos.stations.getById('ops')
  if (ops) return 'ops'

  const stations = await repos.stations.list()
  return stations[0]?.id ?? 'ops'
}

function normalizeStation(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function mergeCapabilities(
  existing: Record<string, unknown> | null | undefined,
  baseline: Record<string, boolean>
): Record<string, unknown> {
  return {
    ...(existing ?? {}),
    ...baseline,
  }
}

export async function syncAgentsFromOpenClaw(
  options: SyncAgentsOptions = {}
): Promise<SyncAgentsResult> {
  const { agents, source } = await discoverAgents(Boolean(options.forceRefresh))

  const repos = getRepos()
  const defaultStationId = await getDefaultStationId()
  const topologyOwnership = await resolveActiveTopologyOwnership()

  let added = 0
  let updated = 0

  const seenSessionKeys = new Set<string>()

  for (const agent of agents) {
    if (!agent?.id) continue

    const normalizedRuntimeId = agent.id.trim().toLowerCase()
    const isMainAgent = normalizedRuntimeId === 'main'
    const ownedTopologyEntry = isMainAgent
      ? null
      : topologyOwnership.byRuntimeId.get(normalizedRuntimeId) ?? null
    const knownTopologyEntry = isMainAgent ? null : getKnownTopologyEntry(normalizedRuntimeId)
    const createTopologyEntry = ownedTopologyEntry ?? knownTopologyEntry
    const name = inferDisplayName(agent)
    const sessionKey = inferSessionKey(agent.id)
    const fallbacks = Array.isArray(agent.fallbacks) ? agent.fallbacks : undefined
    const topologyCapabilities = createTopologyEntry
      ? buildTemplateBaselineCapabilities(createTopologyEntry)
      : null
    const existing =
      (await repos.agents.getBySessionKey(sessionKey))
      ?? (await repos.agents.getByName(agent.id))

    seenSessionKeys.add(sessionKey)

    const mainAgentPatch = isMainAgent
      ? {
          kind: 'ceo' as const,
          role: 'CEO',
          station: 'strategic',
          // Capabilities are used for routing/selection hints and CEO resolution.
          capabilities: {
            strategic: true,
            can_delegate: true,
            can_send_messages: true,
          },
        }
      : null

    if (!existing) {
      const workerStation = createTopologyEntry?.station ?? defaultStationId
      const workerCapabilities = topologyCapabilities ?? { [workerStation]: true }
      const resolvedModel = ownedTopologyEntry?.enforceModel ?? agent.model

      await repos.agents.create({
        name,
        displayName: name,
        slug: slugifyDisplayName(name),
        runtimeAgentId: agent.id,
        ...(mainAgentPatch ?? { kind: createTopologyEntry?.kind ?? 'worker' as const }),
        dispatchEligible: true,
        nameSource: 'openclaw',
        role: mainAgentPatch?.role ?? createTopologyEntry?.role ?? 'agent',
        station: mainAgentPatch?.station ?? workerStation,
        ...(ownedTopologyEntry && topologyOwnership.canonicalTeamId ? { teamId: topologyOwnership.canonicalTeamId } : {}),
        ...(ownedTopologyEntry ? { templateId: ownedTopologyEntry.templateId } : {}),
        sessionKey,
        capabilities: mainAgentPatch?.capabilities ?? workerCapabilities,
        wipLimit: inferDefaultAgentWipLimit({
          id: agent.id,
          name,
          station: mainAgentPatch?.station ?? workerStation,
        }),
        isStale: false,
        staleAt: null,
        ...(resolvedModel ? { model: resolvedModel } : {}),
        ...(fallbacks !== undefined ? { fallbacks: JSON.stringify(fallbacks) } : {}),
      })
      added++
    } else {
      const shouldPromoteMain =
        isMainAgent
        && existing.kind === 'worker'
        && existing.role === 'agent'
        && existing.station === defaultStationId

      const existingCapabilities = existing.capabilities ?? {}
      const promotedCapabilities = shouldPromoteMain && mainAgentPatch
        ? {
            ...existingCapabilities,
            ...mainAgentPatch.capabilities,
          }
        : undefined

      const patch: Record<string, unknown> = {
        ...(existing.nameSource === 'user'
          ? {}
          : {
              displayName: name,
              nameSource: 'openclaw',
            }),
        runtimeAgentId: agent.id,
        isStale: false,
        staleAt: null,
        ...(shouldPromoteMain && mainAgentPatch
          ? {
              kind: mainAgentPatch.kind,
              role: mainAgentPatch.role,
              station: mainAgentPatch.station,
              capabilities: promotedCapabilities,
            }
          : {}),
      }

      if (ownedTopologyEntry && !isMainAgent) {
        const resolvedStation = normalizeStation(existing.station)
        if (
          !resolvedStation
          || resolvedStation === normalizeStation(defaultStationId)
          || ownedTopologyEntry.templateId === 'security'
        ) {
          patch.station = ownedTopologyEntry.station
        }

        if (!existing.templateId) {
          patch.templateId = ownedTopologyEntry.templateId
        }

        if (!existing.teamId && topologyOwnership.canonicalTeamId) {
          patch.teamId = topologyOwnership.canonicalTeamId
        }

        if (ownedTopologyEntry.kind === 'manager' && existing.kind !== 'manager') {
          patch.kind = 'manager'
        }

        if (existing.role.trim().toLowerCase() === 'agent') {
          patch.role = ownedTopologyEntry.role
        }

        if (topologyCapabilities) {
          const mergedCapabilities = mergeCapabilities(existingCapabilities, topologyCapabilities)
          if (JSON.stringify(mergedCapabilities) !== JSON.stringify(existingCapabilities)) {
            patch.capabilities = mergedCapabilities
          }
        }
      }

      const resolvedModel = ownedTopologyEntry?.enforceModel ?? agent.model
      if (resolvedModel) patch.model = resolvedModel
      if (fallbacks !== undefined) patch.fallbacks = JSON.stringify(fallbacks)

      await repos.agents.update(existing.id, patch)
      updated++
    }
  }

  const openClawAgents = await prisma.agent.findMany({
    where: {
      OR: [
        { nameSource: 'openclaw' },
        { sessionKey: { startsWith: 'agent:' } },
      ],
    },
    select: { id: true, sessionKey: true },
  })

  let stale = 0
  const staleAt = new Date()

  for (const dbAgent of openClawAgents) {
    if (seenSessionKeys.has(dbAgent.sessionKey)) continue

    await prisma.agent.update({
      where: { id: dbAgent.id },
      data: {
        isStale: true,
        staleAt,
      },
    })
    stale++
  }

  return { added, updated, stale, source }
}
