import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

/**
 * GET /api/openclaw/sessions
 *
 * Telemetry only — never canonical.
 * Lists cached OpenClaw session telemetry stored in Mission Control DB.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const agentId = searchParams.get('agentId')
  const state = searchParams.get('state')
  const limit = Math.min(Number(searchParams.get('limit') ?? 200), 500)

  const rows = await prisma.agentSession.findMany({
    where: {
      ...(agentId ? { agentId } : {}),
      ...(state ? { state } : {}),
    },
    orderBy: { lastSeenAt: 'desc' },
    take: limit,
  })

  return NextResponse.json({
    data: rows.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      sessionKey: r.sessionKey,
      agentId: r.agentId,
      kind: r.kind,
      model: r.model,
      updatedAtMs: Number(r.updatedAtMs),
      lastSeenAt: r.lastSeenAt,
      abortedLastRun: r.abortedLastRun,
      percentUsed: r.percentUsed,
      state: r.state,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  })
}
