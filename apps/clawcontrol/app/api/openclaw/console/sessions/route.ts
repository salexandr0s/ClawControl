import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { checkGatewayAvailability } from '@/lib/openclaw/console-client'
import { syncAgentSessions } from '@/lib/openclaw/sessions'
import type { AvailabilityStatus } from '@/lib/openclaw/availability'

// ============================================================================
// TYPES
// ============================================================================

export interface ConsoleSessionDTO {
  id: string
  sessionId: string
  sessionKey: string
  source: string
  agentId: string
  kind: string
  model: string | null
  state: string
  percentUsed: number | null
  abortedLastRun: boolean
  operationId: string | null
  workOrderId: string | null
  totalTokens: string | null
  totalCostMicros: string | null
  toolSummary: Array<{ name: string; count: string }>
  hasErrors: boolean
  lastSeenAt: Date
  createdAt: Date
  updatedAt: Date
}

interface SessionsResponse {
  status: AvailabilityStatus
  data: ConsoleSessionDTO[]
  gatewayAvailable: boolean
  cached: boolean
  timestamp: string
}

const AUTO_SYNC_TTL_MS = 4000
let lastAutoSyncAtMs = 0
let autoSyncInFlight: Promise<{ seen: number; upserted: number }> | null = null

function normalizeSourceLabel(value: string): string {
  const key = value.trim().toLowerCase()
  if (!key) return 'unknown'

  const map: Record<string, string> = {
    agent: 'overlay',
    webchat: 'web',
    browser: 'web',
    telegram: 'telegram',
    discord: 'discord',
    signal: 'signal',
    whatsapp: 'whatsapp',
    matrix: 'matrix',
    slack: 'slack',
    teams: 'teams',
  }

  return map[key] ?? key
}

function deriveSessionSource(sessionKey: string, rawJson: string): string {
  // Prefer explicit channel/chatType from telemetry payload when present.
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>
    const channel = typeof parsed.channel === 'string' ? parsed.channel : null
    const chatType = typeof parsed.chatType === 'string' ? parsed.chatType : null
    if (channel) return normalizeSourceLabel(channel)
    if (chatType) return normalizeSourceLabel(chatType)
  } catch {
    // ignore malformed telemetry payload
  }

  // Fallback to session key prefix convention: "<source>:<agent>:<label>"
  const first = sessionKey.split(':')[0] ?? ''
  return normalizeSourceLabel(first)
}

async function ensureSessionsSynced(): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = Date.now()
  if (now - lastAutoSyncAtMs < AUTO_SYNC_TTL_MS) return { ok: true }

  if (!autoSyncInFlight) {
    autoSyncInFlight = syncAgentSessions()
      .finally(() => {
        lastAutoSyncAtMs = Date.now()
        autoSyncInFlight = null
      })
  }

  try {
    await autoSyncInFlight
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to sync sessions' }
  }
}

// ============================================================================
// GET /api/openclaw/console/sessions
// ============================================================================

/**
 * List sessions for the operator console.
 *
 * Query params:
 * - agentId: Filter by agent
 * - state: Filter by state (active, idle, error)
 * - kind: Filter by session kind
 * - limit: Max results (default 200, max 500)
 *
 * Returns cached session data from DB with gateway availability status.
 * Read-only - no governor required.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const agentId = searchParams.get('agentId')
  const state = searchParams.get('state')
  const kind = searchParams.get('kind')
  const containsErrors = searchParams.get('containsErrors')
  const minCostMicros = searchParams.get('minCostMicros')
  const toolUsed = searchParams.get('toolUsed')?.trim().toLowerCase() || null
  const limit = Math.min(Number(searchParams.get('limit') ?? 200), 500)

  try {
    // Query sessions from DB (telemetry cache)
    let rows = await prisma.agentSession.findMany({
      where: {
        ...(agentId ? { agentId } : {}),
        ...(state ? { state } : {}),
        ...(kind ? { kind } : {}),
      },
      orderBy: { lastSeenAt: 'desc' },
      take: limit,
    })

    // If DB cache is empty, pull from OpenClaw and re-query.
    // This fixes the "No sessions" case when the gateway is active but telemetry sync hasn't run yet.
    if (rows.length === 0) {
      const sync = await ensureSessionsSynced()
      if (sync.ok) {
        rows = await prisma.agentSession.findMany({
          where: {
            ...(agentId ? { agentId } : {}),
            ...(state ? { state } : {}),
            ...(kind ? { kind } : {}),
          },
          orderBy: { lastSeenAt: 'desc' },
          take: limit,
        })
      }
    }

    const sessionIds = rows.map((r) => r.sessionId)
    const usageRows = sessionIds.length > 0
      ? await prisma.sessionUsageAggregate.findMany({
        where: { sessionId: { in: sessionIds } },
      })
      : []

    const usageBySessionId = new Map(usageRows.map((row) => [row.sessionId, row]))

    const toolRows = sessionIds.length > 0
      ? await prisma.sessionToolUsage.findMany({
        where: { sessionId: { in: sessionIds } },
        orderBy: [{ callCount: 'desc' }],
      })
      : []

    const toolsBySessionId = new Map<string, Array<{ name: string; count: bigint }>>()
    for (const tool of toolRows) {
      const bucket = toolsBySessionId.get(tool.sessionId) ?? []
      bucket.push({ name: tool.toolName, count: tool.callCount })
      toolsBySessionId.set(tool.sessionId, bucket)
    }

    if (containsErrors === 'true' || containsErrors === 'false' || minCostMicros || toolUsed) {
      let costFloor: bigint | null = null
      if (minCostMicros) {
        try {
          costFloor = BigInt(minCostMicros)
        } catch {
          return NextResponse.json({ error: 'Invalid minCostMicros' }, { status: 400 })
        }
      }

      rows = rows.filter((row) => {
        const usage = usageBySessionId.get(row.sessionId)
        const tools = toolsBySessionId.get(row.sessionId) ?? []
        const hasErrors = Boolean(row.abortedLastRun || usage?.hasErrors)

        if (containsErrors === 'true' && !hasErrors) return false
        if (containsErrors === 'false' && hasErrors) return false

        if (costFloor !== null) {
          if (!usage) return false
          if (usage.totalCostMicros < costFloor) return false
        }

        if (toolUsed) {
          const hasTool = tools.some((t) => t.name.toLowerCase().includes(toolUsed))
          if (!hasTool) return false
        }

        return true
      })
    }

    // Check gateway availability in parallel
    const availability = await checkGatewayAvailability()

    // Map to DTO
    const data: ConsoleSessionDTO[] = rows.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      sessionKey: r.sessionKey,
      source: deriveSessionSource(r.sessionKey, r.rawJson),
      agentId: r.agentId,
      kind: r.kind,
      model: r.model,
      state: r.state,
      percentUsed: r.percentUsed,
      abortedLastRun: r.abortedLastRun,
      operationId: r.operationId,
      workOrderId: r.workOrderId,
      totalTokens: usageBySessionId.get(r.sessionId)?.totalTokens?.toString() ?? null,
      totalCostMicros: usageBySessionId.get(r.sessionId)?.totalCostMicros?.toString() ?? null,
      toolSummary: (toolsBySessionId.get(r.sessionId) ?? [])
        .slice(0, 3)
        .map((tool) => ({
          name: tool.name,
          count: tool.count.toString(),
        })),
      hasErrors: Boolean(r.abortedLastRun || usageBySessionId.get(r.sessionId)?.hasErrors),
      lastSeenAt: r.lastSeenAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }))

    // Determine status based on gateway availability
    const status: AvailabilityStatus = availability.available
      ? (availability.latencyMs > 30000 ? 'degraded' : 'ok')
      : 'unavailable'

    const response: SessionsResponse = {
      status,
      data,
      gatewayAvailable: availability.available,
      cached: true, // Telemetry cache (DB); refreshed from OpenClaw on-demand when empty.
      timestamp: new Date().toISOString(),
    }

    return NextResponse.json(response)
  } catch (err) {
    return NextResponse.json(
      {
        status: 'unavailable' as AvailabilityStatus,
        data: [],
        gatewayAvailable: false,
        cached: false,
        timestamp: new Date().toISOString(),
        error: err instanceof Error ? err.message : 'Failed to fetch sessions',
      },
      { status: 500 }
    )
  }
}
