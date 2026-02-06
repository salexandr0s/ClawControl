import { NextRequest, NextResponse } from 'next/server'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { getRepos } from '@/lib/repo'
import { getAgentModelFromOpenClaw, upsertAgentToOpenClaw } from '@/lib/services/openclaw-config'
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
      stream: 'stdout',
      chunk: `Registering ${agent.displayName} in OpenClaw config...\n`,
    })

    const discoveredModelConfig =
      agent.nameSource === 'openclaw'
        ? await getAgentModelFromOpenClaw(agent.sessionKey)
        : null
    const modelToProvision = discoveredModelConfig?.model ?? agent.model
    const fallbacksToProvision = discoveredModelConfig?.fallbacks ?? agent.fallbacks

    const upsert = await upsertAgentToOpenClaw({
      agentId: agent.runtimeAgentId,
      runtimeAgentId: agent.runtimeAgentId,
      slug: agent.slug,
      displayName: agent.displayName,
      sessionKey: agent.sessionKey,
      model: modelToProvision,
      fallbacks: fallbacksToProvision,
    })

    if (!upsert.ok) {
      await repos.receipts.append(receipt.id, {
        stream: 'stderr',
        chunk: `Failed to register agent in OpenClaw: ${upsert.error}\n`,
      })

      await repos.receipts.finalize(receipt.id, {
        exitCode: 1,
        durationMs: 0,
        parsedJson: {
          error: 'OPENCLAW_REGISTER_FAILED',
          detail: upsert.error,
          agentId: id,
          agentName: agent.displayName,
        },
      })

      return NextResponse.json(
        { error: 'OPENCLAW_REGISTER_FAILED', detail: upsert.error, receiptId: receipt.id },
        { status: 502 }
      )
    }

    await repos.receipts.append(receipt.id, {
      stream: 'stdout',
      chunk: `OpenClaw entry ${upsert.created ? 'created' : 'updated'} for ${upsert.agentId}.\n`,
    })

    await repos.receipts.finalize(receipt.id, {
      exitCode: 0,
      durationMs: 0,
      parsedJson: {
        provisioned: true,
        mode: 'openclaw_config',
        openClawAgentId: upsert.agentId,
        action: upsert.created ? 'created' : 'updated',
      },
    })

    await repos.activities.create({
      type: 'agent.provisioned',
      actor: 'user',
      entityType: 'agent',
      entityId: id,
      summary: `Provisioned agent ${agent.displayName} in OpenClaw`,
      payloadJson: {
        openClawAgentId: upsert.agentId,
        action: upsert.created ? 'created' : 'updated',
        receiptId: receipt.id,
      },
    })

    return NextResponse.json({
      data: {
        mode: 'openclaw_config',
        provisioned: true,
        message: `Agent ${agent.displayName} is registered in OpenClaw (${upsert.created ? 'created' : 'updated'}).`,
      },
      receiptId: receipt.id,
    })
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
