import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { getPlaybook } from '@/lib/fs/playbooks-fs'
import type { ActionKind } from '@clawcontrol/core'

// Playbook execution uses caution level (critical playbooks require danger)
const PLAYBOOK_RUN_ACTION: ActionKind = 'action.caution'

/**
 * POST /api/playbooks/:id/run
 *
 * Execute a playbook. This is a simulated execution that:
 * 1. Parses the YAML content
 * 2. Records a receipt for auditing
 * 3. Returns step-by-step results
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let playbook: { id: string; name: string; content: string; severity?: string } | null = null
  try {
    playbook = await getPlaybook(id)
  } catch {
    return NextResponse.json({ error: 'Failed to read playbook' }, { status: 500 })
  }

  if (!playbook) {
    return NextResponse.json({ error: 'Playbook not found' }, { status: 404 })
  }

  const body = await request.json()
  const { typedConfirmText, workOrderId } = body

  // Critical playbooks require danger-level confirmation
  const actionKind: ActionKind = playbook.severity === 'critical'
    ? 'action.danger'
    : PLAYBOOK_RUN_ACTION

  // Enforce typed confirmation for playbook execution
  const result = await enforceTypedConfirm({
    actionKind,
    typedConfirmText,
  })

  if (!result.allowed) {
    return NextResponse.json(
      {
        error: result.errorType,
        policy: result.policy,
      },
      { status: result.errorType === 'TYPED_CONFIRM_REQUIRED' ? 428 : 403 }
    )
  }

  // Create a receipt for auditing (even though execution is not yet implemented)
  const repos = getRepos()
  const receipt = await repos.receipts.create({
    workOrderId: workOrderId || 'system',
    operationId: null,
    kind: 'playbook_step',
    commandName: `playbook:${playbook.name}`,
    commandArgs: { playbookId: id },
  })

  await repos.receipts.append(receipt.id, {
    stream: 'stderr',
    chunk: 'Playbook execution is not implemented in ClawControl. Use the OpenClaw CLI or gateway to run playbooks.\n',
  })

  await repos.receipts.finalize(receipt.id, {
    exitCode: 1,
    durationMs: 0,
    parsedJson: { error: 'NOT_IMPLEMENTED', playbookId: id, playbookName: playbook.name },
  })

  return NextResponse.json({
    error: 'NOT_IMPLEMENTED',
    receiptId: receipt.id,
  }, { status: 501 })
}
