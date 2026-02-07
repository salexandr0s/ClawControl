import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'
import type { AgentDTO, AgentFilters } from '@/lib/repo'
import { prisma } from '@/lib/db'
import { isFirstRun } from '@/lib/first-run'
import { syncAgentsFromOpenClaw } from '@/lib/sync-agents'
import { getOpenClawConfig } from '@/lib/openclaw-client'
import { extractAgentIdFromSessionKey } from '@/lib/agent-identity'
import { syncAgentSessions } from '@/lib/openclaw/sessions'
import { withRouteTiming } from '@/lib/perf/route-timing'
import { getOrLoadWithCache } from '@/lib/perf/async-cache'

const AUTO_SYNC_TTL_MS = 4_000
const AGENTS_ROUTE_DEFAULT_TTL_MS = 2_500
const AGENTS_ROUTE_LIGHT_TTL_MS = 5_000
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

function parseBooleanParam(value: string | null, fallback: boolean): boolean {
  if (value === null) return fallback
  const normalized = value.trim().toLowerCase()
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false
  return fallback
}

function parseCacheTtlMs(value: string | null, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.min(15_000, Math.floor(parsed)))
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

export const GET = withRouteTiming('api.agents.get', async (request: NextRequest) => {
  const searchParams = request.nextUrl.searchParams

  const filters: AgentFilters = {}
  const requestedStatuses = new Set(parseCsvFilter(searchParams.get('status')))
  const mode = searchParams.get('mode')?.trim().toLowerCase() ?? 'full'
  const lightweight = mode === 'light'

  const includeSessionOverlay = parseBooleanParam(
    searchParams.get('includeSessionOverlay'),
    !lightweight
  )
  const syncSessionsBeforeOverlay = parseBooleanParam(
    searchParams.get('syncSessions'),
    includeSessionOverlay && !lightweight
  )
  const includeModelOverlay = parseBooleanParam(
    searchParams.get('includeModelOverlay'),
    !lightweight
  )

  // Station filter (can be comma-separated)
  const station = searchParams.get('station')
  if (station) {
    filters.station = station.includes(',') ? station.split(',') : station
  }

  try {
    const hasFilters = Boolean(station || requestedStatuses.size > 0)
    const cacheTtlMs = parseCacheTtlMs(
      searchParams.get('cacheTtlMs'),
      lightweight ? AGENTS_ROUTE_LIGHT_TTL_MS : AGENTS_ROUTE_DEFAULT_TTL_MS
    )

    const cacheKey = [
      'api.agents.get',
      `station=${station ?? ''}`,
      `status=${Array.from(requestedStatuses).sort().join(',')}`,
      `sessionOverlay=${includeSessionOverlay ? '1' : '0'}`,
      `syncSessions=${syncSessionsBeforeOverlay ? '1' : '0'}`,
      `modelOverlay=${includeModelOverlay ? '1' : '0'}`,
    ].join('|')

    const { value: data, cacheHit, sharedInFlight } = await getOrLoadWithCache(
      cacheKey,
      cacheTtlMs,
      async () => {
        const repos = getRepos()
        let nextData = await repos.agents.list(filters)

        // First-run fallback: if no filters and DB is empty, attempt OpenClaw sync.
        if (!hasFilters && nextData.length === 0) {
          const firstRun = await isFirstRun()
          if (firstRun) {
            try {
              await syncAgentsFromOpenClaw({ forceRefresh: true })
              nextData = await repos.agents.list(filters)
            } catch (syncErr) {
              console.warn(
                '[api/agents] OpenClaw first-run sync failed:',
                syncErr instanceof Error ? syncErr.message : String(syncErr)
              )
            }
          }
        }

        if (includeSessionOverlay && nextData.length > 0) {
          try {
            if (syncSessionsBeforeOverlay) {
              await ensureSessionsSynced()
            }
            nextData = await overlaySessionStatus(nextData)
          } catch (sessionErr) {
            console.warn(
              '[api/agents] Session telemetry overlay failed:',
              sessionErr instanceof Error ? sessionErr.message : String(sessionErr)
            )
          }
        }

        // Overlay latest model/fallback metadata from OpenClaw config without mutating DB.
        if (!hasFilters && includeModelOverlay && nextData.length > 0) {
          try {
            const config = await getOpenClawConfig()
            if (config?.agents?.length) {
              const byRuntimeId = new Map(
                config.agents
                  .filter((agent) => agent.id && agent.id.trim())
                  .map((agent) => [agent.id.trim().toLowerCase(), agent] as const)
              )

              nextData = nextData.map((agent) => {
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
          nextData = nextData.filter((agent) => requestedStatuses.has(agent.status))
        }

        return nextData
      }
    )

    return NextResponse.json({
      data,
      meta: {
        mode: lightweight ? 'light' : 'full',
        cache: {
          cacheHit,
          sharedInFlight,
          ttlMs: cacheTtlMs,
        },
      },
    })
  } catch (error) {
    console.error('[api/agents] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch agents' },
      { status: 500 }
    )
  }
})
