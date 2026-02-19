import { NextResponse } from 'next/server'
import { asAuthErrorResponse, verifyInternalToken } from '@/lib/auth/operator-auth'
import { withRouteTiming } from '@/lib/perf/route-timing'
import { pollAndRelayOpsActionable } from '@/lib/services/ops-actionable-intake'

interface PollRelayBody {
  limit?: number
  teamId?: string
  relayKey?: string
}

const postInternalOpsActionablePollRelayRoute = async (request: Request) => {
  const auth = verifyInternalToken(request)
  if (!auth.ok) {
    return NextResponse.json(asAuthErrorResponse(auth), { status: auth.status })
  }

  let body: PollRelayBody = {}
  try {
    const parsed = await request.json().catch(() => null) as PollRelayBody | null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      body = parsed
    }
  } catch {
    body = {}
  }

  const limitFromQuery = new URL(request.url).searchParams.get('limit')
  const teamIdFromQuery = new URL(request.url).searchParams.get('teamId')
  const relayKeyFromQuery = new URL(request.url).searchParams.get('relayKey')
  const queryLimit = limitFromQuery ? Number(limitFromQuery) : null
  const limit = Number.isFinite(body.limit) ? Number(body.limit) : queryLimit
  const teamId = typeof body.teamId === 'string' && body.teamId.trim()
    ? body.teamId.trim()
    : teamIdFromQuery?.trim() || null
  const relayKey = typeof body.relayKey === 'string' && body.relayKey.trim()
    ? body.relayKey.trim()
    : relayKeyFromQuery?.trim() || null

  const result = await pollAndRelayOpsActionable(limit ?? 10, {
    ...(teamId ? { teamId } : {}),
    ...(relayKey ? { relayKey } : {}),
  })
  return NextResponse.json({
    data: {
      count: result.items.length,
      items: result.items,
    },
  })
}

export const POST = withRouteTiming(
  'api.internal.ops.actionable.poll-relay.post',
  postInternalOpsActionablePollRelayRoute
)
