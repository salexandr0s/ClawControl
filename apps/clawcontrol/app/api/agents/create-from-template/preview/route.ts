import { NextRequest, NextResponse } from 'next/server'
import { getTemplateById, previewTemplateRender, renderTemplate } from '@/lib/templates'
import { generateAgentName, generateSessionKey } from '@/lib/workspace'

interface CreateFromTemplatePreviewInput {
  templateId: string
  params: Record<string, unknown>
}

/**
 * POST /api/agents/create-from-template/preview
 *
 * Renders a template with parameters and returns a preview of the files that
 * would be generated. Does NOT create agents or write files.
 *
 * Safe / read-only: no governor confirmation required.
 */
export async function POST(request: NextRequest) {
  let input: CreateFromTemplatePreviewInput
  try {
    input = (await request.json()) as CreateFromTemplatePreviewInput
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const templateId = typeof input.templateId === 'string' ? input.templateId : ''
  const params = input.params && typeof input.params === 'object' ? input.params : {}

  if (!templateId) {
    return NextResponse.json({ error: 'templateId is required' }, { status: 400 })
  }

  const template = await getTemplateById(templateId)
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }

  if (!template.isValid) {
    return NextResponse.json(
      {
        error: 'Cannot preview invalid template',
        validationErrors: template.validationErrors,
      },
      { status: 400 }
    )
  }

  // Validate required params against template schema
  if (template.config?.paramsSchema?.required) {
    const missingParams: string[] = []
    for (const required of template.config.paramsSchema.required) {
      if (!(required in params) || (params as Record<string, unknown>)[required] === undefined || (params as Record<string, unknown>)[required] === '') {
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

  try {
    const role = template.config?.role || template.role
    const agentName = generateAgentName(role)
    const sessionKeyPattern = template.config?.sessionKeyPattern
    const sessionKey = sessionKeyPattern
      ? renderTemplate(sessionKeyPattern, { ...params, agentName })
      : generateSessionKey(agentName)

    const mergedParams = {
      ...template.config?.defaults,
      ...params,
      agentName,
      sessionKey,
    }

    const renderedFiles = await previewTemplateRender(templateId, mergedParams)

    return NextResponse.json({
      data: {
        template: {
          id: template.id,
          name: template.name,
          version: template.version,
          role: template.role,
        },
        agentName,
        sessionKey,
        files: renderedFiles.map((f) => ({
          source: f.source,
          destination: f.destination,
          contentPreview: f.content.slice(0, 200) + (f.content.length > 200 ? '...' : ''),
        })),
      },
    })
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Failed to render preview',
      },
      { status: 500 }
    )
  }
}

