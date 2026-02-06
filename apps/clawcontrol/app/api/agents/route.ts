import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'
import type { AgentDTO, AgentFilters } from '@/lib/repo'
import { prisma } from '@/lib/db'
import { isFirstRun } from '@/lib/first-run'
import { syncAgentsFromOpenClaw } from '@/lib/sync-agents'
import { getOpenClawConfig } from '@/lib/openclaw-client'
import { extractAgentIdFromSessionKey } from '@/lib/agent-identity'
import { syncAgentSessions } from '@/lib/openclaw/sessions'

const AUTO_SYNC_TTL_MS = 4_000
let lastAutoSyncAtMs = 0
let autoSyncInFlight: Promise<{ seen: number; upserted: number }> | null = null

const STATUS_PRIORITY: Record<'idle' | 'active' | 'error', number> = {
  idle: 1,
  active: 2,
  error: 3,
}

function parseCsvFilter(value: string | null): string[] {
  if (!value) return []

  return value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

function normalizeSessionState(value: string): 'idle' | 'active' | 'error' | null {
  if (value === 'idle' || value === 'active' || value === 'error') return value
  return null
}

function toRuntimeTokens(agent: AgentDTO): string[] {
  const out = new Set<string>()
  const values = [
    agent.runtimeAgentId,
    extractAgentIdFromSessionKey(agent.sessionKey) ?? undefined,
    agent.slug,
  ]

  for (const value of values) {
    const raw = value?.trim()
    if (!raw) continue
    out.add(raw)
    out.add(raw.toLowerCase())
  }

  return Array.from(out)
}

async function ensureSessionsSynced(): Promise<void> {
  const now = Date.now()
  if (now - lastAutoSyncAtMs < AUTO_SYNC_TTL_MS) return

  if (!autoSyncInFlight) {
    autoSyncInFlight = syncAgentSessions()
      .finally(() => {
        lastAutoSyncAtMs = Date.now()
        autoSyncInFlight = null
      })
  }

  await autoSyncInFlight
}

function mergeStatus(
  current: AgentDTO['status'],
  sessionState: 'idle' | 'active' | 'error'
): AgentDTO['status'] {
  if (sessionState === 'error') return 'error'
  if (sessionState === 'active') return 'active'
  if (sessionState === 'idle') return current === 'blocked' ? 'blocked' : 'idle'
  return current
}

async function overlaySessionStatus(agents: AgentDTO[]): Promise<AgentDTO[]> {
  if (agents.length === 0) return agents

  const runtimeIds = new Set<string>()
  const tokensByAgent = new Map<string, string[]>()

  for (const agent of agents) {
    const tokens = toRuntimeTokens(agent)
    tokensByAgent.set(agent.id, tokens)
    for (const token of tokens) runtimeIds.add(token)
  }

  if (runtimeIds.size === 0) return agents

  const rows = await prisma.agentSession.findMany({
    where: { agentId: { in: Array.from(runtimeIds) } },
    select: { agentId: true, state: true, lastSeenAt: true },
    orderBy: { lastSeenAt: 'desc' },
  })

  const bestByRuntimeId = new Map<string, { state: 'idle' | 'active' | 'error'; seenAtMs: number }>()
  for (const row of rows) {
    const runtimeId = row.agentId.trim().toLowerCase()
    if (!runtimeId) continue

    const state = normalizeSessionState(row.state)
    if (!state) continue

    const seenAtMs = row.lastSeenAt.getTime()
    const existing = bestByRuntimeId.get(runtimeId)
    if (!existing) {
      bestByRuntimeId.set(runtimeId, { state, seenAtMs })
      continue
    }

    const existingPriority = STATUS_PRIORITY[existing.state]
    const nextPriority = STATUS_PRIORITY[state]
    if (nextPriority > existingPriority || (nextPriority === existingPriority && seenAtMs > existing.seenAtMs)) {
      bestByRuntimeId.set(runtimeId, { state, seenAtMs })
    }
  }

  return agents.map((agent) => {
    const tokens = tokensByAgent.get(agent.id) ?? []

    let best: { state: 'idle' | 'active' | 'error'; seenAtMs: number } | null = null
    for (const token of tokens) {
      const candidate = bestByRuntimeId.get(token.toLowerCase())
      if (!candidate) continue
      if (!best) {
        best = candidate
        continue
      }

      const bestPriority = STATUS_PRIORITY[best.state]
      const nextPriority = STATUS_PRIORITY[candidate.state]
      if (nextPriority > bestPriority || (nextPriority === bestPriority && candidate.seenAtMs > best.seenAtMs)) {
        best = candidate
      }
    }

    if (!best) return agent

    const status = mergeStatus(agent.status, best.state)
    const shouldUpdateSeenAt = !agent.lastSeenAt || best.seenAtMs > agent.lastSeenAt.getTime()

    if (status === agent.status && !shouldUpdateSeenAt) return agent

    return {
      ...agent,
      status,
      lastSeenAt: shouldUpdateSeenAt ? new Date(best.seenAtMs) : agent.lastSeenAt,
    }
  })
}

/**
 * GET /api/agents
 *
 * List agents with optional filters
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams

  const filters: AgentFilters = {}
  const requestedStatuses = new Set(parseCsvFilter(searchParams.get('status')))

  // Station filter (can be comma-separated)
  const station = searchParams.get('station')
  if (station) {
    filters.station = station.includes(',') ? station.split(',') : station
  }

  try {
    const repos = getRepos()
    let data = await repos.agents.list(filters)

    // First-run fallback: if no filters and DB is empty, attempt OpenClaw sync.
    const hasFilters = Boolean(station || requestedStatuses.size > 0)
    if (!hasFilters && data.length === 0) {
      const firstRun = await isFirstRun()
      if (firstRun) {
        try {
          await syncAgentsFromOpenClaw({ forceRefresh: true })
          data = await repos.agents.list(filters)
        } catch (syncErr) {
          console.warn(
            '[api/agents] OpenClaw first-run sync failed:',
            syncErr instanceof Error ? syncErr.message : String(syncErr)
          )
        }
      }
    }

    if (data.length > 0) {
      try {
        await ensureSessionsSynced()
        data = await overlaySessionStatus(data)
      } catch (sessionErr) {
        console.warn(
          '[api/agents] Session telemetry overlay failed:',
          sessionErr instanceof Error ? sessionErr.message : String(sessionErr)
        )
      }
    }

    // Overlay latest model/fallback metadata from OpenClaw config without mutating DB.
    if (!hasFilters && data.length > 0) {
      try {
        const config = await getOpenClawConfig()
        if (config?.agents?.length) {
          const byRuntimeId = new Map(
            config.agents
              .filter((agent) => agent.id && agent.id.trim())
              .map((agent) => [agent.id.trim().toLowerCase(), agent] as const)
          )

          data = data.map((agent) => {
            const runtimeAgentId =
              agent.runtimeAgentId?.trim() ||
              extractAgentIdFromSessionKey(agent.sessionKey) ||
              ''
            const discovered = runtimeAgentId ? byRuntimeId.get(runtimeAgentId.toLowerCase()) : undefined

            if (!discovered) return agent

            return {
              ...agent,
              model: discovered.model ?? agent.model,
              fallbacks: discovered.fallbacks ?? agent.fallbacks,
            }
          })
        }
      } catch (overlayErr) {
        console.warn(
          '[api/agents] OpenClaw model overlay failed:',
          overlayErr instanceof Error ? overlayErr.message : String(overlayErr)
        )
      }
    }

    if (requestedStatuses.size > 0) {
      data = data.filter((agent) => requestedStatuses.has(agent.status))
    }

    return NextResponse.json({ data })
  } catch (error) {
    console.error('[api/agents] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch agents' },
      { status: 500 }
    )
  }
}
