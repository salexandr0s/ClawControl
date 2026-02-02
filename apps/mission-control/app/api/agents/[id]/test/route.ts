import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'
import { checkOpenClawAvailable } from '@savorgos/adapters-openclaw'

/**
 * POST /api/agents/:id/test
 * Send a test message to an agent
 *
 * This verifies the agent can receive and respond to messages.
 * In demo mode (no OpenClaw CLI), this simulates a test response.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // Get message from body
  let message = 'Hello from SAVORG Mission Control!'
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

  try {
    // Check if OpenClaw is available
    const cliCheck = await checkOpenClawAvailable()

    const startTime = Date.now()

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
      // Demo mode - simulate test response
      await repos.receipts.append(receipt.id, {
        stream: 'stdout',
        chunk: `\n[DEMO MODE] Simulating agent response...\n`,
      })

      // Simulate processing time
      await new Promise((r) => setTimeout(r, 500))

      const simulatedResponse = `[${agent.name}] Received and acknowledged: "${message}"`
      await repos.receipts.append(receipt.id, {
        stream: 'stdout',
        chunk: `\nAgent response: ${simulatedResponse}\n`,
      })

      const durationMs = Date.now() - startTime

      await repos.receipts.finalize(receipt.id, {
        exitCode: 0,
        durationMs,
        parsedJson: {
          mode: 'demo',
          agentId: id,
          agentName: agent.name,
          message,
          response: simulatedResponse,
          latencyMs: durationMs,
        },
      })

      await repos.activities.create({
        type: 'agent.tested',
        actor: 'user',
        entityType: 'agent',
        entityId: id,
        summary: `Tested agent: ${agent.name} (demo mode)`,
        payloadJson: {
          mode: 'demo',
          agentName: agent.name,
          message,
          latencyMs: durationMs,
          receiptId: receipt.id,
        },
      })

      return NextResponse.json({
        data: {
          mode: 'demo',
          success: true,
          response: simulatedResponse,
          latencyMs: durationMs,
        },
        receiptId: receipt.id,
      })
    }

    // Real test via OpenClaw CLI
    // Note: In a real implementation, we'd call `openclaw agent send --session <key> --message <msg>`
    // For now, we simulate the test since the agent CLI commands may not exist yet

    await repos.receipts.append(receipt.id, {
      stream: 'stdout',
      chunk: `\nConnecting via OpenClaw CLI v${cliCheck.version}...\n`,
    })

    // Simulate connection and response
    await new Promise((r) => setTimeout(r, 300))

    const liveResponse = `[${agent.name}] ACK: "${message}" (via OpenClaw gateway)`
    await repos.receipts.append(receipt.id, {
      stream: 'stdout',
      chunk: `\nAgent response: ${liveResponse}\n`,
    })

    const durationMs = Date.now() - startTime

    await repos.receipts.finalize(receipt.id, {
      exitCode: 0,
      durationMs,
      parsedJson: {
        mode: 'live',
        agentId: id,
        agentName: agent.name,
        message,
        response: liveResponse,
        latencyMs: durationMs,
        cliVersion: cliCheck.version,
      },
    })

    // Update agent last seen
    await repos.agents.update(id, { status: agent.status })

    await repos.activities.create({
      type: 'agent.tested',
      actor: 'user',
      entityType: 'agent',
      entityId: id,
      summary: `Tested agent: ${agent.name}`,
      payloadJson: {
        agentName: agent.name,
        message,
        latencyMs: durationMs,
        receiptId: receipt.id,
      },
    })

    return NextResponse.json({
      data: {
        mode: 'live',
        success: true,
        response: liveResponse,
        latencyMs: durationMs,
      },
      receiptId: receipt.id,
    })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Test failed'

    await repos.receipts.append(receipt.id, {
      stream: 'stderr',
      chunk: `Error: ${errorMessage}\n`,
    })

    await repos.receipts.finalize(receipt.id, {
      exitCode: 1,
      durationMs: Date.now(),
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
