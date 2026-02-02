import { NextRequest, NextResponse } from 'next/server'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { getRepos } from '@/lib/repo'
import { getTemplateById, getTemplateFiles, getTemplateFileContent } from '@/lib/templates'

/**
 * GET /api/agent-templates/:id/export
 * Export a template as a zip file
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // Get template
  const template = getTemplateById(id)
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }

  // Get typed confirm from query params (for GET requests)
  const { searchParams } = new URL(request.url)
  const typedConfirmText = searchParams.get('confirm') || undefined

  // Enforce Governor - template.export
  const result = await enforceTypedConfirm({
    actionKind: 'template.export',
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

  // Create receipt for the operation
  const receipt = await repos.receipts.create({
    workOrderId: 'system',
    kind: 'manual',
    commandName: 'template.export',
    commandArgs: { templateId: id, templateName: template.name },
  })

  try {
    // Get all template files
    const files = getTemplateFiles(id)

    // Build a JSON representation (in production, this would be a zip file)
    const exportData: Record<string, string> = {}

    for (const file of files) {
      const content = getTemplateFileContent(file.id)
      if (content !== null) {
        exportData[file.name] = content
      }
    }

    await repos.receipts.append(receipt.id, {
      stream: 'stdout',
      chunk: `Exporting template ${template.name}...\n`,
    })
    await repos.receipts.append(receipt.id, {
      stream: 'stdout',
      chunk: `  Files: ${Object.keys(exportData).join(', ')}\n`,
    })

    // Log activity
    await repos.activities.create({
      type: 'template.exported',
      actor: 'user',
      entityType: 'template',
      entityId: id,
      summary: `Exported template ${template.name}`,
      payloadJson: {
        templateId: id,
        templateName: template.name,
        fileCount: files.length,
      },
    })

    // Finalize receipt
    await repos.receipts.finalize(receipt.id, {
      exitCode: 0,
      durationMs: 0,
      parsedJson: {
        templateId: id,
        templateName: template.name,
        fileCount: files.length,
      },
    })

    // In development, return JSON. In production, this would be a zip blob.
    // For proper zip generation, we'd use JSZip or similar
    const exportPayload = {
      templateId: id,
      name: template.name,
      version: template.version,
      exportedAt: new Date().toISOString(),
      files: exportData,
    }

    // Return as downloadable JSON (simulating zip for development)
    return new NextResponse(JSON.stringify(exportPayload, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${id}.template.json"`,
      },
    })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to export template'

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
