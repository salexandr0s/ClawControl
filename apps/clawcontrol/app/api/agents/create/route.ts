import { NextRequest, NextResponse } from 'next/server'
import { enforceActionPolicy } from '@/lib/with-governor'
import { getRepos } from '@/lib/repo'
import {
  generateAgentName,
  generateSessionKey,
  createAgentFiles,
  AGENT_ROLE_MAP,
} from '@/lib/workspace'
import { upsertAgentToOpenClaw, removeAgentFromOpenClaw } from '@/lib/services/openclaw-config'
import { buildUniqueSlug, slugifyDisplayName } from '@/lib/agent-identity'
import { isCanonicalStationId, normalizeStationId, type StationId } from '@clawcontrol/core'

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
  const { role, purpose, capabilities = [], customName, displayName, typedConfirmText } = body

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
  const result = await enforceActionPolicy({
    actionKind: 'agent.create',
    typedConfirmText,
  })

  if (!result.allowed) {
    return NextResponse.json(
      {
        error: result.errorType,
        policy: result.policy,
      },
      { status: result.status ?? (result.errorType === 'TYPED_CONFIRM_REQUIRED' ? 428 : 403) }
    )
  }

  const repos = getRepos()

  // Resolve user-facing name and immutable slug
  const resolvedDisplayName = String(displayName ?? customName ?? generateAgentName(role)).trim()
  const existingAgents = await repos.agents.list()
  const slug = buildUniqueSlug(
    slugifyDisplayName(resolvedDisplayName),
    existingAgents.map((agent) => agent.slug)
  )

  // Check if display name already exists
  const existing = await repos.agents.getByName(resolvedDisplayName)
  if (existing) {
    return NextResponse.json(
      { error: 'AGENT_EXISTS', message: `Agent with display name "${resolvedDisplayName}" already exists` },
      { status: 409 }
    )
  }

  // Determine station from role
  const roleMapping = AGENT_ROLE_MAP[role.toLowerCase()]
  const station = normalizeStationId(roleMapping?.station || 'build')
  if (!isCanonicalStationId(station)) {
    return NextResponse.json(
      { error: 'INVALID_STATION', message: `Resolved station "${station}" is not canonical` },
      { status: 400 }
    )
  }
  const stationId: StationId = station

  // Generate session key
  const sessionKey = generateSessionKey(slug)

  // Build capabilities object
  const capabilitiesObj: Record<string, boolean> = {}
  for (const cap of capabilities) {
    capabilitiesObj[cap] = true
  }
  // Add default capability based on station
  capabilitiesObj[stationId] = true

  // Create receipt for the operation
  const receipt = await repos.receipts.create({
    workOrderId: 'system',
    kind: 'manual',
    commandName: 'agent.create',
    commandArgs: { displayName: resolvedDisplayName, slug, role, station: stationId, purpose },
  })

  let createdAgentId: string | null = null
  let openClawAgentId: string | null = null
  let openClawEntryCreated = false

  try {
    // Step 1: Create workspace files
    await repos.receipts.append(receipt.id, {
      stream: 'stdout',
      chunk: `Creating workspace files for ${resolvedDisplayName} (${slug})...\n`,
    })

    const filesResult = await createAgentFiles({
      displayName: resolvedDisplayName,
      slug,
      role,
      purpose,
      capabilities,
      station: stationId,
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
      chunk: `  Created memory file: ${filesResult.files.memory}\n`,
    })
    await repos.receipts.append(receipt.id, {
      stream: 'stdout',
      chunk: `  Created overlay file: ${filesResult.files.overlay}\n`,
    })

    // Step 2: Register/update in OpenClaw config so runtime can see the agent
    await repos.receipts.append(receipt.id, {
      stream: 'stdout',
      chunk: 'Registering agent in OpenClaw config...\n',
    })

    const openClawSync = await upsertAgentToOpenClaw({
      agentId: slug,
      runtimeAgentId: slug,
      slug,
      displayName: resolvedDisplayName,
      sessionKey,
    })

    if (!openClawSync.ok) {
      throw new Error(`Failed to register agent in OpenClaw: ${openClawSync.error}`)
    }

    openClawAgentId = openClawSync.agentId ?? slug
    openClawEntryCreated = Boolean(openClawSync.created)

    await repos.receipts.append(receipt.id, {
      stream: 'stdout',
      chunk: `  OpenClaw entry: ${openClawSync.created ? 'created' : 'updated'} (${openClawAgentId})\n`,
    })

    // Step 3: Create agent in database
    await repos.receipts.append(receipt.id, {
      stream: 'stdout',
      chunk: `Creating agent record...\n`,
    })

    const agent = await repos.agents.create({
      name: resolvedDisplayName,
      displayName: resolvedDisplayName,
      slug,
      runtimeAgentId: openClawAgentId,
      nameSource: displayName || customName ? 'user' : 'system',
      role,
      station: stationId,
      sessionKey,
      capabilities: capabilitiesObj,
      wipLimit: 2,
    })
    createdAgentId = agent.id

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
        displayName: resolvedDisplayName,
        slug,
        role,
        station: stationId,
        sessionKey,
        openClawAgentId,
        openClawSynced: true,
        files: filesResult.files,
      },
    })

    // Log activity
    await repos.activities.create({
      type: 'agent.created',
      actor: 'user',
      entityType: 'agent',
      entityId: agent.id,
      summary: `Created new agent: ${resolvedDisplayName}`,
      payloadJson: {
        displayName: resolvedDisplayName,
        slug,
        role,
        station: stationId,
        purpose,
        capabilities,
        openClawAgentId,
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

    if (!createdAgentId && openClawEntryCreated && openClawAgentId) {
      const rollback = await removeAgentFromOpenClaw(openClawAgentId)
      await repos.receipts.append(receipt.id, {
        stream: rollback.ok ? 'stdout' : 'stderr',
        chunk: rollback.ok
          ? `Rolled back OpenClaw entry for ${openClawAgentId} after DB failure.\n`
          : `Failed to roll back OpenClaw entry for ${openClawAgentId}: ${rollback.error}\n`,
      })
    }

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
