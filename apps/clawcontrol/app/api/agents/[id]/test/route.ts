import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'
import { checkOpenClawAvailable } from '@clawcontrol/adapters-openclaw'

/**
 * POST /api/agents/:id/test
 * Send a test message to an agent
 *
 * This verifies the agent can receive and respond to messages.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // Get message from body
  let message = 'Hello from clawcontrol!'
  try {
    const body = await request.json()
    if (body.message) {
      message = body.message
    }
  } catch {
    // Body might be empty, use default message
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
    commandName: 'agent.test',
    commandArgs: {
      agentId: id,
      agentName: agent.name,
      message,
    },
  })

  const startTime = Date.now()

  try {
    // Check if OpenClaw is available
    const cliCheck = await checkOpenClawAvailable()

    await repos.receipts.append(receipt.id, {
      stream: 'stdout',
      chunk: `Testing agent: ${agent.name}\n`,
    })
    await repos.receipts.append(receipt.id, {
      stream: 'stdout',
      chunk: `Session: ${agent.sessionKey}\n`,
    })
    await repos.receipts.append(receipt.id, {
      stream: 'stdout',
      chunk: `\nSending message: "${message}"\n`,
    })

    if (!cliCheck.available) {
      await repos.receipts.append(receipt.id, {
        stream: 'stderr',
        chunk: 'OpenClaw CLI not available. Agent test requires OpenClaw.\n',
      })

      await repos.receipts.finalize(receipt.id, {
        exitCode: 1,
        durationMs: Date.now() - startTime,
        parsedJson: { error: 'OPENCLAW_UNAVAILABLE', agentId: id, agentName: agent.name },
      })

      return NextResponse.json(
        { error: 'OPENCLAW_UNAVAILABLE', receiptId: receipt.id },
        { status: 503 }
      )
    }

    await repos.receipts.append(receipt.id, {
      stream: 'stdout',
      chunk: `\nOpenClaw CLI v${cliCheck.version} detected.\n`,
    })

    await repos.receipts.append(receipt.id, {
      stream: 'stderr',
      chunk: 'Agent test messaging is not implemented in ClawControl. Use OpenClaw to send a message to the agent.\n',
    })

    await repos.receipts.finalize(receipt.id, {
      exitCode: 1,
      durationMs: Date.now() - startTime,
      parsedJson: {
        error: 'NOT_IMPLEMENTED',
        agentId: id,
        agentName: agent.name,
        message,
        cliVersion: cliCheck.version,
      },
    })

    return NextResponse.json(
      { error: 'NOT_IMPLEMENTED', receiptId: receipt.id },
      { status: 501 }
    )
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Test failed'

    await repos.receipts.append(receipt.id, {
      stream: 'stderr',
      chunk: `Error: ${errorMessage}\n`,
    })

    await repos.receipts.finalize(receipt.id, {
      exitCode: 1,
      durationMs: Date.now() - startTime,
      parsedJson: { error: errorMessage },
    })

    await repos.activities.create({
      type: 'agent.test_failed',
      actor: 'user',
      entityType: 'agent',
      entityId: id,
      summary: `Test failed for agent: ${agent.name}`,
      payloadJson: {
        agentName: agent.name,
        error: errorMessage,
        receiptId: receipt.id,
      },
    })

    return NextResponse.json(
      { error: errorMessage, receiptId: receipt.id },
      { status: 500 }
    )
  }
}
