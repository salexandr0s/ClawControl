import { NextResponse } from 'next/server'
import { asAuthErrorResponse, verifyInternalToken } from '@/lib/auth/operator-auth'
import { withRouteTiming } from '@/lib/perf/route-timing'
import { ingestOpsActionableEvent, type OpsActionableIntakePayload } from '@/lib/services/ops-actionable-intake'

const postInternalOpsActionableRoute = async (request: Request) => {
  const auth = verifyInternalToken(request)
  if (!auth.ok) {
    return NextResponse.json(asAuthErrorResponse(auth), { status: auth.status })
  }

  let body: OpsActionableIntakePayload
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  try {
    const result = await ingestOpsActionableEvent(body)
    return NextResponse.json(
      { data: result },
      { status: result.created ? 201 : 200 }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to ingest actionable event'
    const status = message.includes('requires non-empty summary') ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export const POST = withRouteTiming(
  'api.internal.ops.actionable.post',
  postInternalOpsActionableRoute
)

