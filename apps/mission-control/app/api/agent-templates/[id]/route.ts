import { NextRequest, NextResponse } from 'next/server'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { getRepos } from '@/lib/repo'
import {
  getTemplateById,
  getTemplateFiles,
  getTemplateReadme,
  scanTemplates,
} from '@/lib/templates'
import { mockWorkspaceFiles, mockFileContents } from '@savorg/core'

/**
 * GET /api/agent-templates/:id
 * Get template details with files and README
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const template = getTemplateById(id)
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }

  // Get template files
  const files = getTemplateFiles(id)

  // Get README content
  const readme = getTemplateReadme(id)

  return NextResponse.json({
    data: {
      ...template,
      files,
      readme,
    },
  })
}

/**
 * DELETE /api/agent-templates/:id
 * Delete a template
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const template = getTemplateById(id)
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }

  // Get typed confirm from body
  let typedConfirmText: string | undefined
  try {
    const body = await request.json()
    typedConfirmText = body.typedConfirmText
  } catch {
    // Body might be empty
  }

  // Enforce Governor - template.delete is danger level
  const result = await enforceTypedConfirm({
    actionKind: 'template.delete',
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
    commandName: 'template.delete',
    commandArgs: {
      templateId: id,
      templateName: template.name,
    },
  })

  try {
    const templatePath = template.path

    // Remove all files in template folder
    const filesToRemove = mockWorkspaceFiles.filter(
      (f) => f.path === templatePath && f.type === 'file'
    )

    for (const file of filesToRemove) {
      // Remove file content
      delete mockFileContents[file.id]
      // Remove file from array
      const fileIndex = mockWorkspaceFiles.findIndex((f) => f.id === file.id)
      if (fileIndex >= 0) {
        mockWorkspaceFiles.splice(fileIndex, 1)
      }
    }

    // Remove folder
    const folderIndex = mockWorkspaceFiles.findIndex(
      (f) => f.path === '/agent-templates' && f.name === id && f.type === 'folder'
    )
    if (folderIndex >= 0) {
      mockWorkspaceFiles.splice(folderIndex, 1)
    }

    // Rescan templates
    scanTemplates()

    await repos.receipts.finalize(receipt.id, {
      exitCode: 0,
      durationMs: 0,
      parsedJson: {
        templateId: id,
        templateName: template.name,
        filesRemoved: filesToRemove.length,
      },
    })

    // Log activity
    await repos.activities.create({
      type: 'template.deleted',
      actor: 'user',
      entityType: 'template',
      entityId: id,
      summary: `Deleted template: ${template.name}`,
      payloadJson: {
        templateId: id,
        templateName: template.name,
        receiptId: receipt.id,
      },
    })

    return NextResponse.json({
      success: true,
      receiptId: receipt.id,
    })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Template deletion failed'

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
