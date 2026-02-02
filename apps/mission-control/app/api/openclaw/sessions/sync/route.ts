import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { runCommandJson } from '@savorg/adapters-openclaw'
import { detectPrismaHmrMismatchHint, safeStack, parseExplicitLinkage } from './_helpers'

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
      // Newer OpenClaw builds may include arbitrary flags.
      flags?: string[]
      // Optional explicit metadata (future-proof)
      metadata?: {
        operationId?: string
        workOrderId?: string
      }
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
  // Telemetry only — never canonical.
  // This endpoint must fail soft (never crash dev server).
  const phase: { step: string } = { step: 'init' }

  try {
    phase.step = 'openclaw.status'
    const res = await runCommandJson<OpenClawStatusAll>('status.all.json')

    if (res.error || !res.data) {
      phase.step = 'openclaw.status.error'

      // Emit an activity for visibility (telemetry category; does not mutate tasks)
      await prisma.activity.create({
        data: {
          type: 'openclaw.sessions_sync_failed',
          actor: 'system',
          entityType: 'telemetry',
          entityId: 'openclaw.sessions',
          summary: 'OpenClaw sessions sync failed (status.all.json)'
            + (res.error ? `: ${res.error}` : ''),
          payloadJson: JSON.stringify({
            code: 'OPENCLAW_SYNC_FAILED',
            phase: phase.step,
            hint: 'Check OpenClaw CLI availability and JSON output',
            error: res.error ?? null,
          }),
        },
      })

      return NextResponse.json(
        {
          code: 'OPENCLAW_SYNC_FAILED',
          message: 'Failed to read OpenClaw status JSON',
          details: {
            phase: phase.step,
            hint: 'Check OpenClaw CLI and status output',
            error: res.error ?? null,
          },
        },
        { status: 502 }
      )
    }

    phase.step = 'parse'
    const recent = res.data.sessions?.recent ?? []

    phase.step = 'upsert'
    let upserted = 0

    for (const s of recent) {
      if (!s?.sessionId || !s?.key || !s?.agentId) continue

      const updatedAtMs = BigInt(s.updatedAt)
      const lastSeenAt = new Date(s.updatedAt)

      const linkage = parseExplicitLinkage({
        sessionKey: s.key,
        flags: s.flags,
        metadata: s.metadata,
      })

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
          operationId: linkage.operationId ?? null,
          workOrderId: linkage.workOrderId ?? null,
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
          operationId: linkage.operationId ?? null,
          workOrderId: linkage.workOrderId ?? null,
          rawJson: JSON.stringify(s),
        },
      })

      upserted++
    }

    phase.step = 'done'
    return NextResponse.json({
      stats: {
        seen: recent.length,
        upserted,
      },
    })
  } catch (err) {
    const hint = detectPrismaHmrMismatchHint(err)

    // Emit an activity for visibility (telemetry category; does not mutate tasks)
    try {
      await prisma.activity.create({
        data: {
          type: 'openclaw.sessions_sync_failed',
          actor: 'system',
          entityType: 'telemetry',
          entityId: 'openclaw.sessions',
          summary: 'OpenClaw sessions sync failed (exception)',
          payloadJson: JSON.stringify({
            code: 'OPENCLAW_SYNC_FAILED',
            phase: phase.step,
            hint,
            stackTrimmed: safeStack(err),
          }),
        },
      })
    } catch {
      // Never let telemetry failure crash the server.
    }

    return NextResponse.json(
      {
        code: 'OPENCLAW_SYNC_FAILED',
        message: 'OpenClaw sessions sync failed',
        details: {
          phase: phase.step,
          hint,
          stackTrimmed: safeStack(err),
        },
      },
      { status: 502 }
    )
  }
}
