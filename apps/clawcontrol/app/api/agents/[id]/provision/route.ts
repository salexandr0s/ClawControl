import { NextRequest, NextResponse } from 'next/server'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { getRepos } from '@/lib/repo'
import {
  checkOpenClawAvailable,
} from '@clawcontrol/adapters-openclaw'

/**
 * POST /api/agents/:id/provision
 * Provision an agent in OpenClaw (create session config)
 *
 * This registers the agent with OpenClaw gateway so it can receive messages.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // Get typed confirm from body
  let typedConfirmText: string | undefined
  try {
    const body = await request.json()
    typedConfirmText = body.typedConfirmText
  } catch {
    // Body might be empty
  }

  // Enforce Governor - agent.provision is caution level
  const result = await enforceTypedConfirm({
    actionKind: 'agent.provision',
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

  const repos = getRepos()

  // Get agent
  const agent = await repos.agents.getById(id)
  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  // Create receipt
  const receipt = await repos.receipts.create({
    workOrderId: 'system',
    kind: 'manual',
    commandName: 'agent.provision',
    commandArgs: {
      agentId: id,
      agentName: agent.name,
      sessionKey: agent.sessionKey,
    },
  })

  try {
    // Check if OpenClaw is available
    const cliCheck = await checkOpenClawAvailable()

    if (!cliCheck.available) {
      await repos.receipts.append(receipt.id, {
        stream: 'stderr',
        chunk: 'OpenClaw CLI not available. Agent provisioning requires OpenClaw.\n',
      })
      await repos.receipts.finalize(receipt.id, {
        exitCode: 1,
        durationMs: 0,
        parsedJson: { error: 'OPENCLAW_UNAVAILABLE', agentId: id, agentName: agent.name },
      })

      return NextResponse.json(
        { error: 'OPENCLAW_UNAVAILABLE', receiptId: receipt.id },
        { status: 503 }
      )
    }

    await repos.receipts.append(receipt.id, {
      stream: 'stderr',
      chunk: 'Agent provisioning is not implemented in ClawControl. Configure provisioning in OpenClaw.\n',
    })

    await repos.receipts.finalize(receipt.id, {
      exitCode: 1,
      durationMs: 0,
      parsedJson: { error: 'NOT_IMPLEMENTED', agentId: id, agentName: agent.name },
    })

    return NextResponse.json(
      { error: 'NOT_IMPLEMENTED', receiptId: receipt.id },
      { status: 501 }
    )
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Provisioning failed'

    await repos.receipts.append(receipt.id, {
      stream: 'stderr',
      chunk: `Error: ${errorMessage}\n`,
    })

    await repos.receipts.finalize(receipt.id, {
      exitCode: 1,
      durationMs: 0,
      parsedJson: { error: errorMessage },
    })

    return NextResponse.json(
      { error: errorMessage, receiptId: receipt.id },
      { status: 500 }
    )
  }
}
