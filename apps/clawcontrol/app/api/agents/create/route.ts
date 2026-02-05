import { NextRequest, NextResponse } from 'next/server'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { getRepos } from '@/lib/repo'
import {
  generateAgentName,
  generateSessionKey,
  createAgentFiles,
  AGENT_ROLE_MAP,
} from '@/lib/workspace'
import type { StationId } from '@clawcontrol/core'

/**
 * POST /api/agents/create
 * Create a new agent with workspace files
 *
 * Body:
 * - role: string (required) - Agent role (e.g., "build", "spec", "qa")
 * - purpose: string (required) - Short description of agent's purpose
 * - capabilities: string[] (optional) - List of capabilities
 * - customName: string (optional) - Override auto-generated name
 * - typedConfirmText: string (required for CONFIRM mode)
 */
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { role, purpose, capabilities = [], customName, typedConfirmText } = body

  // Validate required fields
  if (!role || typeof role !== 'string') {
    return NextResponse.json(
      { error: 'Role is required' },
      { status: 400 }
    )
  }

  if (!purpose || typeof purpose !== 'string') {
    return NextResponse.json(
      { error: 'Purpose is required' },
      { status: 400 }
    )
  }

  // Enforce Governor - agent.create is caution level
  const result = await enforceTypedConfirm({
    actionKind: 'agent.create',
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

  // Generate agent name (or use custom)
  const name = customName || generateAgentName(role)

  // Check if agent already exists
  const existing = await repos.agents.getByName(name)
  if (existing) {
    return NextResponse.json(
      { error: 'AGENT_EXISTS', message: `Agent with name "${name}" already exists` },
      { status: 409 }
    )
  }

  // Determine station from role
  const roleMapping = AGENT_ROLE_MAP[role.toLowerCase()]
  const station: StationId = roleMapping?.station || 'build'

  // Generate session key
  const sessionKey = generateSessionKey(name)

  // Build capabilities object
  const capabilitiesObj: Record<string, boolean> = {}
  for (const cap of capabilities) {
    capabilitiesObj[cap] = true
  }
  // Add default capability based on station
  capabilitiesObj[station] = true

  // Create receipt for the operation
  const receipt = await repos.receipts.create({
    workOrderId: 'system',
    kind: 'manual',
    commandName: 'agent.create',
    commandArgs: { name, role, station, purpose },
  })

  try {
    // Step 1: Create workspace files
    await repos.receipts.append(receipt.id, {
      stream: 'stdout',
      chunk: `Creating workspace files for ${name}...\n`,
    })

    const filesResult = await createAgentFiles({
      name,
      role,
      purpose,
      capabilities,
      station,
    })

    if (!filesResult.success) {
      await repos.receipts.append(receipt.id, {
        stream: 'stderr',
        chunk: `Failed to create workspace files: ${filesResult.error}\n`,
      })

      await repos.receipts.finalize(receipt.id, {
        exitCode: 1,
        durationMs: 0,
        parsedJson: { error: filesResult.error },
      })

      return NextResponse.json(
        { error: 'FILE_CREATE_FAILED', message: filesResult.error },
        { status: 500 }
      )
    }

    await repos.receipts.append(receipt.id, {
      stream: 'stdout',
      chunk: `  Created soul file: ${filesResult.files.soul}\n`,
    })
    await repos.receipts.append(receipt.id, {
      stream: 'stdout',
      chunk: `  Created heartbeat file: ${filesResult.files.heartbeat}\n`,
    })
    await repos.receipts.append(receipt.id, {
      stream: 'stdout',
      chunk: `  Created overlay file: ${filesResult.files.overlay}\n`,
    })
    if (filesResult.files.agentsMd) {
      await repos.receipts.append(receipt.id, {
        stream: 'stdout',
        chunk: `  Updated AGENTS.md\n`,
      })
    }

    // Step 2: Create agent in database
    await repos.receipts.append(receipt.id, {
      stream: 'stdout',
      chunk: `Creating agent record...\n`,
    })

    const agent = await repos.agents.create({
      name,
      role,
      station,
      sessionKey,
      capabilities: capabilitiesObj,
      wipLimit: 2,
    })

    await repos.receipts.append(receipt.id, {
      stream: 'stdout',
      chunk: `  Agent ID: ${agent.id}\n`,
    })
    await repos.receipts.append(receipt.id, {
      stream: 'stdout',
      chunk: `  Session Key: ${sessionKey}\n`,
    })

    // Finalize receipt
    await repos.receipts.finalize(receipt.id, {
      exitCode: 0,
      durationMs: 0,
      parsedJson: {
        agentId: agent.id,
        name,
        role,
        station,
        sessionKey,
        files: filesResult.files,
      },
    })

    // Log activity
    await repos.activities.create({
      type: 'agent.created',
      actor: 'user',
      entityType: 'agent',
      entityId: agent.id,
      summary: `Created new agent: ${name}`,
      payloadJson: {
        name,
        role,
        station,
        purpose,
        capabilities,
        receiptId: receipt.id,
      },
    })

    return NextResponse.json({
      data: agent,
      files: filesResult.files,
      receiptId: receipt.id,
    })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Agent creation failed'

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
