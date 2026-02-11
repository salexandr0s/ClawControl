import { NextRequest, NextResponse } from 'next/server'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { getRepos } from '@/lib/repo'
import {
  getTemplateById,
  renderTemplate,
  previewTemplateRender,
} from '@/lib/templates'
import { upsertAgentToOpenClaw, removeAgentFromOpenClaw } from '@/lib/services/openclaw-config'
import { generateAgentName, generateSessionKey, AGENT_ROLE_MAP } from '@/lib/workspace'
import { buildUniqueSlug, slugifyDisplayName } from '@/lib/agent-identity'
import { isCanonicalStationId, normalizeStationId, type StationId } from '@clawcontrol/core'

interface CreateFromTemplateInput {
  templateId: string
  params: Record<string, unknown>
  displayName?: string
  typedConfirmText: string
}

/**
 * POST /api/agents/create-from-template
 * Create a new agent from a template
 */
export async function POST(request: NextRequest) {
  let input: CreateFromTemplateInput

  try {
    input = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { templateId, params, typedConfirmText } = input

  // Validate required fields
  if (!templateId) {
    return NextResponse.json({ error: 'templateId is required' }, { status: 400 })
  }

  // Get the template
  const template = await getTemplateById(templateId)
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }

  // Check if template is valid
  if (!template.isValid) {
    return NextResponse.json(
      {
        error: 'Cannot create agent from invalid template',
        validationErrors: template.validationErrors,
      },
      { status: 400 }
    )
  }

  // Enforce Governor - agent.create_from_template
  const result = await enforceTypedConfirm({
    actionKind: 'agent.create_from_template',
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

  // Validate required params against template schema
  if (template.config?.paramsSchema?.required) {
    const missingParams: string[] = []
    for (const required of template.config.paramsSchema.required) {
      if (!(required in params) || params[required] === undefined || params[required] === '') {
        missingParams.push(required)
      }
    }
    if (missingParams.length > 0) {
      return NextResponse.json(
        { error: `Missing required parameters: ${missingParams.join(', ')}` },
        { status: 400 }
      )
    }
  }

  const repos = getRepos()

  // Generate display name, immutable slug, and session key
  const role = template.config?.role || template.role
  const agentDisplayName = String(input.displayName ?? generateAgentName(role)).trim()
  const existingAgents = await repos.agents.list()
  const agentSlug = buildUniqueSlug(
    slugifyDisplayName(agentDisplayName),
    existingAgents.map((agent) => agent.slug)
  )

  const duplicateByName = await repos.agents.getByName(agentDisplayName)
  if (duplicateByName) {
    return NextResponse.json(
      { error: `Agent with display name "${agentDisplayName}" already exists` },
      { status: 409 }
    )
  }

  const sessionKeyPattern = template.config?.sessionKeyPattern
  const sessionKey = sessionKeyPattern
    ? renderTemplate(sessionKeyPattern, {
        ...params,
        agentName: agentDisplayName, // legacy alias
        agentDisplayName,
        agentSlug,
      })
    : generateSessionKey(agentSlug)

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

  // Merge defaults with provided params
  const mergedParams = {
    ...template.config?.defaults,
    ...params,
    agentName: agentDisplayName, // legacy alias for templates
    agentDisplayName,
    agentSlug,
    sessionKey,
  }

  // Preview what files would be created
  const renderedFiles = await previewTemplateRender(templateId, mergedParams)

  // Create receipt for the operation
  const receipt = await repos.receipts.create({
    workOrderId: 'system',
    kind: 'manual',
    commandName: 'agent.create_from_template',
    commandArgs: { templateId, agentDisplayName, agentSlug, params: mergedParams },
  })

  let createdAgentId: string | null = null
  let openClawAgentId: string | null = null
  let openClawEntryCreated = false

  try {
    // Log to receipt
    await repos.receipts.append(receipt.id, {
      stream: 'stdout',
      chunk: `Creating agent ${agentDisplayName} (${agentSlug}) from template ${template.name}...\n`,
    })

    // Build capabilities object based on template role
    const capabilitiesObj: Record<string, boolean> = {
      canRead: true,
      canWrite: true,
      canExecute: role === 'BUILD' || role === 'OPS',
      canApprove: role === 'CEO' || role === 'REVIEW',
      canDelegate: role === 'CEO' || role === 'MANAGER',
    }

    await repos.receipts.append(receipt.id, {
      stream: 'stdout',
      chunk: 'Registering agent in OpenClaw config...\n',
    })

    const openClawSync = await upsertAgentToOpenClaw({
      agentId: agentSlug,
      runtimeAgentId: agentSlug,
      slug: agentSlug,
      displayName: agentDisplayName,
      sessionKey,
    })

    if (!openClawSync.ok) {
      throw new Error(`Failed to register agent in OpenClaw: ${openClawSync.error}`)
    }

    openClawAgentId = openClawSync.agentId ?? agentSlug
    openClawEntryCreated = Boolean(openClawSync.created)

    await repos.receipts.append(receipt.id, {
      stream: 'stdout',
      chunk: `  OpenClaw entry: ${openClawSync.created ? 'created' : 'updated'} (${openClawAgentId})\n`,
    })

    // Create the agent record
    const agent = await repos.agents.create({
      name: agentDisplayName,
      displayName: agentDisplayName,
      slug: agentSlug,
      runtimeAgentId: openClawAgentId,
      nameSource: input.displayName ? 'user' : 'system',
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
    await repos.receipts.append(receipt.id, {
      stream: 'stdout',
      chunk: `  Files to generate: ${renderedFiles.length}\n`,
    })

    // Log activity
    await repos.activities.create({
      type: 'agent.created_from_template',
      actor: 'user',
      entityType: 'agent',
      entityId: agent.id,
      summary: `Created agent ${agentDisplayName} from template ${template.name}`,
      payloadJson: {
        templateId,
        templateName: template.name,
        agentDisplayName,
        agentSlug,
        role,
        station: stationId,
        filesGenerated: renderedFiles.length,
        openClawAgentId,
      },
    })

    // Finalize receipt
    await repos.receipts.finalize(receipt.id, {
      exitCode: 0,
      durationMs: 0,
      parsedJson: {
        agentId: agent.id,
        agentDisplayName,
        agentSlug,
        templateId,
        station: stationId,
        filesGenerated: renderedFiles.length,
        openClawAgentId,
        openClawSynced: true,
      },
    })

    return NextResponse.json({
      data: agent,
      agentDisplayName,
      agentSlug,
      files: renderedFiles.map((f) => ({
        source: f.source,
        destination: f.destination,
        contentPreview: f.content.slice(0, 200) + (f.content.length > 200 ? '...' : ''),
      })),
      template: {
        id: template.id,
        name: template.name,
        version: template.version,
      },
      receiptId: receipt.id,
    })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to create agent'

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

    console.error('Failed to create agent from template:', err)
    return NextResponse.json(
      { error: errorMessage, receiptId: receipt.id },
      { status: 500 }
    )
  }
}

/**
 * GET /api/agents/create-from-template?templateId=xxx
 * Preview what would be created (without actually creating)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const templateId = searchParams.get('templateId')

  if (!templateId) {
    return NextResponse.json({ error: 'templateId is required' }, { status: 400 })
  }

  const template = await getTemplateById(templateId)
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }

  // Return template info and schema for params
  return NextResponse.json({
    data: {
      template: {
        id: template.id,
        name: template.name,
        description: template.description,
        version: template.version,
        role: template.role,
        isValid: template.isValid,
        validationErrors: template.validationErrors,
        validationWarnings: template.validationWarnings,
      },
      paramsSchema: template.config?.paramsSchema || null,
      defaults: template.config?.defaults || {},
      recommendations: template.config?.recommendations || null,
      renderTargets: template.config?.render?.targets || [],
    },
  })
}
