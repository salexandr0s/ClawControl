import { NextRequest, NextResponse } from 'next/server'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { getRepos } from '@/lib/repo'
import {
  getTemplateById,
  renderTemplate,
  previewTemplateRender,
} from '@/lib/templates'
import { generateAgentName, generateSessionKey, AGENT_ROLE_MAP } from '@/lib/workspace'
import type { Station } from '@savorgos/core'

interface CreateFromTemplateInput {
  templateId: string
  params: Record<string, unknown>
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
  const template = getTemplateById(templateId)
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

  // Generate agent name and session key
  const role = template.config?.role || template.role
  const agentName = generateAgentName(role)
  const sessionKeyPattern = template.config?.sessionKeyPattern
  const sessionKey = sessionKeyPattern
    ? renderTemplate(sessionKeyPattern, { ...params, agentName })
    : generateSessionKey(agentName)

  // Determine station from role
  const roleMapping = AGENT_ROLE_MAP[role.toLowerCase()]
  const station: Station = roleMapping?.station || 'build'

  // Merge defaults with provided params
  const mergedParams = {
    ...template.config?.defaults,
    ...params,
    agentName,
    sessionKey,
  }

  // Preview what files would be created
  const renderedFiles = previewTemplateRender(templateId, mergedParams)

  // Create receipt for the operation
  const receipt = await repos.receipts.create({
    workOrderId: 'system',
    kind: 'manual',
    commandName: 'agent.create_from_template',
    commandArgs: { templateId, agentName, params: mergedParams },
  })

  try {
    // Log to receipt
    await repos.receipts.append(receipt.id, {
      stream: 'stdout',
      chunk: `Creating agent ${agentName} from template ${template.name}...\n`,
    })

    // Build capabilities object based on template role
    const capabilitiesObj: Record<string, boolean> = {
      canRead: true,
      canWrite: true,
      canExecute: role === 'BUILD' || role === 'OPS',
      canApprove: role === 'CEO' || role === 'REVIEW',
    }

    // Create the agent record
    const agent = await repos.agents.create({
      name: agentName,
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
      summary: `Created agent ${agentName} from template ${template.name}`,
      payloadJson: {
        templateId,
        templateName: template.name,
        agentName,
        role,
        filesGenerated: renderedFiles.length,
      },
    })

    // Finalize receipt
    await repos.receipts.finalize(receipt.id, {
      exitCode: 0,
      durationMs: 0,
      parsedJson: {
        agentId: agent.id,
        agentName,
        templateId,
        filesGenerated: renderedFiles.length,
      },
    })

    return NextResponse.json({
      data: agent,
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

  const template = getTemplateById(templateId)
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
