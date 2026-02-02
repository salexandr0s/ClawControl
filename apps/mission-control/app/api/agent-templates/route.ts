import { NextRequest, NextResponse } from 'next/server'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { getRepos } from '@/lib/repo'
import {
  getTemplates,
  scanTemplates,
  createTemplateScaffold,
} from '@/lib/templates'

/**
 * GET /api/agent-templates
 * List all agent templates with validity status
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const rescan = searchParams.get('rescan') === 'true'
  const role = searchParams.get('role')

  // Get templates (optionally force rescan)
  let templates = getTemplates(rescan)

  // Filter by role if specified
  if (role) {
    templates = templates.filter((t) => t.role === role)
  }

  return NextResponse.json({
    data: templates,
    count: templates.length,
  })
}

/**
 * POST /api/agent-templates
 * Create a new template scaffold
 */
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { id, name, role, typedConfirmText } = body

  // Validate required fields
  if (!id || typeof id !== 'string') {
    return NextResponse.json(
      { error: 'Template ID is required' },
      { status: 400 }
    )
  }

  if (!name || typeof name !== 'string') {
    return NextResponse.json(
      { error: 'Template name is required' },
      { status: 400 }
    )
  }

  if (!role || typeof role !== 'string') {
    return NextResponse.json(
      { error: 'Template role is required' },
      { status: 400 }
    )
  }

  // Enforce Governor - template.create is caution level
  const result = await enforceTypedConfirm({
    actionKind: 'template.create',
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

  // Create receipt
  const receipt = await repos.receipts.create({
    workOrderId: 'system',
    kind: 'manual',
    commandName: 'template.create',
    commandArgs: { id, name, role },
  })

  try {
    // Create template scaffold
    const createResult = createTemplateScaffold(id, name, role)

    if (!createResult.success) {
      await repos.receipts.finalize(receipt.id, {
        exitCode: 1,
        durationMs: 0,
        parsedJson: { error: createResult.error },
      })

      return NextResponse.json(
        { error: createResult.error, receiptId: receipt.id },
        { status: 400 }
      )
    }

    // Rescan to get the new template
    const templates = scanTemplates()
    const newTemplate = templates.find((t) => t.id === id)

    await repos.receipts.finalize(receipt.id, {
      exitCode: 0,
      durationMs: 0,
      parsedJson: {
        templateId: id,
        templatePath: createResult.templatePath,
        template: newTemplate,
      },
    })

    // Log activity
    await repos.activities.create({
      type: 'template.created',
      actor: 'user',
      entityType: 'template',
      entityId: id,
      summary: `Created template: ${name}`,
      payloadJson: {
        templateId: id,
        name,
        role,
        receiptId: receipt.id,
      },
    })

    return NextResponse.json({
      data: newTemplate,
      receiptId: receipt.id,
    })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Template creation failed'

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
