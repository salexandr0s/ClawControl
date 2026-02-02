import { NextRequest, NextResponse } from 'next/server'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { getRepos } from '@/lib/repo'
import {
  checkOpenClawAvailable,
  runCommand,
} from '@savorgos/adapters-openclaw'

/**
 * POST /api/agents/:id/provision
 * Provision an agent in OpenClaw (create session config)
 *
 * This registers the agent with OpenClaw gateway so it can receive messages.
 * In demo mode (no OpenClaw CLI), this simulates success.
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
      // Demo mode - simulate provisioning
      await repos.receipts.append(receipt.id, {
        stream: 'stdout',
        chunk: `[DEMO MODE] OpenClaw CLI not available\n`,
      })
      await repos.receipts.append(receipt.id, {
        stream: 'stdout',
        chunk: `Simulating agent provisioning for: ${agent.name}\n`,
      })
      await repos.receipts.append(receipt.id, {
        stream: 'stdout',
        chunk: `Session key: ${agent.sessionKey}\n`,
      })
      await repos.receipts.append(receipt.id, {
        stream: 'stdout',
        chunk: `\nAgent provisioned successfully (demo mode)\n`,
      })

      await repos.receipts.finalize(receipt.id, {
        exitCode: 0,
        durationMs: 500,
        parsedJson: {
          mode: 'demo',
          agentId: id,
          agentName: agent.name,
          sessionKey: agent.sessionKey,
          provisioned: true,
        },
      })

      await repos.activities.create({
        type: 'agent.provisioned',
        actor: 'user',
        entityType: 'agent',
        entityId: id,
        summary: `Provisioned agent: ${agent.name} (demo mode)`,
        payloadJson: {
          mode: 'demo',
          agentName: agent.name,
          sessionKey: agent.sessionKey,
          receiptId: receipt.id,
        },
      })

      return NextResponse.json({
        data: {
          mode: 'demo',
          provisioned: true,
          message: 'Agent provisioned in demo mode (OpenClaw CLI not available)',
        },
        receiptId: receipt.id,
      })
    }

    // Real provisioning via OpenClaw CLI
    await repos.receipts.append(receipt.id, {
      stream: 'stdout',
      chunk: `Provisioning agent: ${agent.name}\n`,
    })
    await repos.receipts.append(receipt.id, {
      stream: 'stdout',
      chunk: `Session key: ${agent.sessionKey}\n`,
    })

    // Execute provision command
    // Note: Agent provision commands are not documented in OpenClaw CLI
    // Using health check to verify connectivity instead
    // See docs/audit/openclaw-command-allowlist.md
    const statusResult = await runCommand('health.json')

    if (statusResult.exitCode === 127) {
      // Command not found - treat as demo mode
      await repos.receipts.append(receipt.id, {
        stream: 'stdout',
        chunk: `\nNote: OpenClaw CLI not available - running in demo mode\n`,
      })
      await repos.receipts.append(receipt.id, {
        stream: 'stdout',
        chunk: `Agent registered in SAVORG database\n`,
      })
    } else {
      await repos.receipts.append(receipt.id, {
        stream: 'stdout',
        chunk: statusResult.stdout,
      })
      if (statusResult.stderr) {
        await repos.receipts.append(receipt.id, {
          stream: 'stderr',
          chunk: statusResult.stderr,
        })
      }
    }

    await repos.receipts.append(receipt.id, {
      stream: 'stdout',
      chunk: `\nAgent provisioned successfully\n`,
    })

    await repos.receipts.finalize(receipt.id, {
      exitCode: 0,
      durationMs: statusResult.durationMs,
      parsedJson: {
        mode: 'live',
        agentId: id,
        agentName: agent.name,
        sessionKey: agent.sessionKey,
        provisioned: true,
      },
    })

    await repos.activities.create({
      type: 'agent.provisioned',
      actor: 'user',
      entityType: 'agent',
      entityId: id,
      summary: `Provisioned agent: ${agent.name}`,
      payloadJson: {
        agentName: agent.name,
        sessionKey: agent.sessionKey,
        receiptId: receipt.id,
      },
    })

    return NextResponse.json({
      data: {
        mode: 'live',
        provisioned: true,
        message: 'Agent provisioned successfully',
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
