import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { runCommandJson } from '@savorg/adapters-openclaw'

type OpenClawStatusAll = {
  sessions?: {
    recent?: Array<{
      agentId: string
      key: string
      kind: string
      sessionId: string
      updatedAt: number
      age?: number
      abortedLastRun?: boolean
      percentUsed?: number
      model?: string
    }>
  }
}

function deriveState(s: { abortedLastRun?: boolean; age?: number }): string {
  if (s.abortedLastRun) return 'error'
  // Consider anything updated within the last 2 minutes as active-ish
  if (typeof s.age === 'number' && s.age < 120_000) return 'active'
  return 'idle'
}

/**
 * POST /api/openclaw/sessions/sync
 *
 * Telemetry only — never canonical.
 * Pulls `openclaw status --all --json` and upserts session telemetry into DB.
 * Does NOT create or mutate WorkOrders/Operations.
 */
export async function POST() {
  const res = await runCommandJson<OpenClawStatusAll>('status.all.json')

  if (res.error || !res.data) {
    return NextResponse.json(
      { error: 'OPENCLAW_STATUS_ALL_FAILED', detail: res.error ?? 'Unknown error' },
      { status: 502 }
    )
  }

  const recent = res.data.sessions?.recent ?? []

  let upserted = 0

  for (const s of recent) {
    if (!s?.sessionId || !s?.key || !s?.agentId) continue

    const updatedAtMs = BigInt(s.updatedAt)
    const lastSeenAt = new Date(s.updatedAt)

    await prisma.agentSession.upsert({
      where: { sessionId: s.sessionId },
      create: {
        sessionId: s.sessionId,
        sessionKey: s.key,
        agentId: s.agentId,
        kind: s.kind ?? 'unknown',
        model: s.model ?? null,
        updatedAtMs,
        lastSeenAt,
        abortedLastRun: Boolean(s.abortedLastRun),
        percentUsed: typeof s.percentUsed === 'number' ? Math.floor(s.percentUsed) : null,
        state: deriveState({ abortedLastRun: s.abortedLastRun, age: s.age }),
        rawJson: JSON.stringify(s),
      },
      update: {
        sessionKey: s.key,
        agentId: s.agentId,
        kind: s.kind ?? 'unknown',
        model: s.model ?? null,
        updatedAtMs,
        lastSeenAt,
        abortedLastRun: Boolean(s.abortedLastRun),
        percentUsed: typeof s.percentUsed === 'number' ? Math.floor(s.percentUsed) : null,
        state: deriveState({ abortedLastRun: s.abortedLastRun, age: s.age }),
        rawJson: JSON.stringify(s),
      },
    })

    upserted++
  }

  return NextResponse.json({
    stats: {
      seen: recent.length,
      upserted,
    },
  })
}
