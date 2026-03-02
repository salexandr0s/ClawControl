import { NextResponse } from 'next/server'
import { asAuthErrorResponse, verifyOperatorRequest } from '@/lib/auth/operator-auth'
import { createErrorRemediationWorkOrder, type ErrorRemediationMode } from '@/lib/openclaw/error-remediation'

interface RouteContext {
  params: Promise<{ hash: string }>
}

interface RemediationBody {
  mode?: ErrorRemediationMode
}

function isValidSignatureHash(hash: string): boolean {
  return /^[a-f0-9]{64}$/i.test(hash)
}

export async function POST(request: Request, context: RouteContext) {
  const auth = verifyOperatorRequest(request, { requireCsrf: true })
  if (!auth.ok) {
    return NextResponse.json(asAuthErrorResponse(auth), { status: auth.status })
  }

  const { hash } = await context.params
  if (!isValidSignatureHash(hash)) {
    return NextResponse.json(
      { error: 'Invalid signature hash', code: 'INVALID_SIGNATURE_HASH' },
      { status: 400 }
    )
  }

  let body: RemediationBody = {}
  try {
    body = (await request.json()) as RemediationBody
  } catch {
    // empty body is allowed
  }

  const mode = body.mode === 'create_and_start' ? 'create_and_start' : 'create'

  try {
    const remediation = await createErrorRemediationWorkOrder(hash, mode)
    return NextResponse.json({
      data: {
        workOrderId: remediation.workOrderId,
        code: remediation.code,
        mode: remediation.mode,
        started: remediation.started,
        operationId: remediation.operationId,
        workflowId: remediation.workflowId,
        startError: remediation.startError,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create remediation work order'
    if (message.toLowerCase().includes('unknown error signature')) {
      return NextResponse.json(
        { error: message, code: 'SIGNATURE_NOT_FOUND' },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { error: message, code: 'REMEDIATION_FAILED' },
      { status: 500 }
    )
  }
}
