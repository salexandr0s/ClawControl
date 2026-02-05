import { NextRequest, NextResponse } from 'next/server'
import { promises as fsp } from 'node:fs'
import { dirname } from 'node:path'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { getRepos } from '@/lib/repo'
import { validateWorkspacePath } from '@/lib/fs/path-policy'
import {
  getTemplateById,
  validateTemplateConfig,
  scanTemplates,
} from '@/lib/templates'
import { validateZipEntryName, MAX_FILE_SIZE, MAX_TOTAL_SIZE, MAX_FILES } from '@/lib/fs/zip-safety'

interface ImportTemplatePayload {
  templateId: string
  name: string
  version: string
  exportedAt: string
  files: Record<string, string>
}

/**
 * POST /api/agent-templates/import
 * Import a template from a zip/JSON export
 *
 * Body (JSON):
 * - template: ImportTemplatePayload - The exported template data
 * - typedConfirmText: string - Confirmation text
 */
export async function POST(request: NextRequest) {
  let body: { template: ImportTemplatePayload; typedConfirmText?: string }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { template: importData, typedConfirmText } = body

  // Validate required fields
  if (!importData || !importData.templateId || !importData.files) {
    return NextResponse.json(
      { error: 'Invalid template data: missing templateId or files' },
      { status: 400 }
    )
  }

  // Check if template.json is included
  if (!importData.files['template.json']) {
    return NextResponse.json(
      { error: 'Invalid template: missing template.json file' },
      { status: 400 }
    )
  }

  // Validate file count limit
  const fileNames = Object.keys(importData.files)
  if (fileNames.length > MAX_FILES) {
    return NextResponse.json(
      { error: `Too many files: ${fileNames.length} (max ${MAX_FILES})` },
      { status: 400 }
    )
  }

  // Validate total size limit
  let totalSize = 0
  for (const fileName of fileNames) {
    const content = importData.files[fileName]
    const fileSize = content.length

    // Validate individual file size
    if (fileSize > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large: ${fileName} (${fileSize} bytes, max ${MAX_FILE_SIZE})` },
        { status: 400 }
      )
    }

    totalSize += fileSize
  }

  if (totalSize > MAX_TOTAL_SIZE) {
    return NextResponse.json(
      { error: `Import too large: ${totalSize} bytes (max ${MAX_TOTAL_SIZE})` },
      { status: 400 }
    )
  }

  // Validate file names (zip slip prevention)
  for (const fileName of fileNames) {
    const validation = validateZipEntryName(fileName)
    if (!validation.valid) {
      return NextResponse.json(
        { error: `Invalid file name: ${validation.error}` },
        { status: 400 }
      )
    }
  }

  // Enforce Governor - template.import
  const result = await enforceTypedConfirm({
    actionKind: 'template.import',
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

  // Validate template.json content
  let templateConfig: unknown
  try {
    templateConfig = JSON.parse(importData.files['template.json'])
  } catch {
    return NextResponse.json(
      { error: 'Invalid template.json: failed to parse JSON' },
      { status: 400 }
    )
  }

  const validation = validateTemplateConfig(templateConfig, { expectedId: importData.templateId })
  if (!validation.valid) {
    return NextResponse.json(
      {
        error: 'Template validation failed',
        validationErrors: validation.errors,
        validationWarnings: validation.warnings,
      },
      { status: 400 }
    )
  }

  // Check if template already exists
  const existingTemplate = await getTemplateById(importData.templateId)
  if (existingTemplate) {
    return NextResponse.json(
      { error: `Template "${importData.templateId}" already exists` },
      { status: 409 }
    )
  }

  const repos = getRepos()

  // Create receipt for the operation
  const receipt = await repos.receipts.create({
    workOrderId: 'system',
    kind: 'manual',
    commandName: 'template.import',
    commandArgs: { templateId: importData.templateId, templateName: importData.name },
  })

  try {
    const templateId = importData.templateId
    const templatePath = `/agent-templates/${templateId}`

    await repos.receipts.append(receipt.id, {
      stream: 'stdout',
      chunk: `Importing template ${importData.name}...\n`,
    })

    const dirRes = validateWorkspacePath(templatePath)
    if (!dirRes.valid || !dirRes.resolvedPath) {
      throw new Error(dirRes.error || `Invalid template path: ${templatePath}`)
    }

    try {
      await fsp.access(dirRes.resolvedPath)
      throw new Error(`Template "${templateId}" already exists`)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }

    await fsp.mkdir(dirRes.resolvedPath, { recursive: false })

    await repos.receipts.append(receipt.id, {
      stream: 'stdout',
      chunk: `  Created folder: ${templatePath}\n`,
    })

    for (const fileName of fileNames) {
      const parts = fileName.split('/')
      if (parts.some((p) => p === '' || p === '.' || p === '..')) {
        throw new Error(`Invalid file name: ${fileName}`)
      }
      if (parts.some((p) => p.startsWith('.'))) {
        throw new Error(`Invalid file name (hidden path segment): ${fileName}`)
      }

      const content = importData.files[fileName]
      const filePath = `${templatePath}/${fileName}`
      const fileRes = validateWorkspacePath(filePath)
      if (!fileRes.valid || !fileRes.resolvedPath) {
        throw new Error(fileRes.error || `Invalid file path: ${filePath}`)
      }

      await fsp.mkdir(dirname(fileRes.resolvedPath), { recursive: true })
      await fsp.writeFile(fileRes.resolvedPath, content, 'utf8')

      await repos.receipts.append(receipt.id, {
        stream: 'stdout',
        chunk: `  Created file: ${fileName} (${content.length} bytes)\n`,
      })
    }

    // Rescan templates to pick up the new one
    const updatedTemplates = await scanTemplates()
    const newTemplate = updatedTemplates.find((t) => t.id === templateId)

    // Log activity
    await repos.activities.create({
      type: 'template.imported',
      actor: 'user',
      entityType: 'template',
      entityId: templateId,
      summary: `Imported template ${importData.name}`,
      payloadJson: {
        templateId,
        templateName: importData.name,
        fileCount: fileNames.length,
        exportedAt: importData.exportedAt,
      },
    })

    // Finalize receipt
    await repos.receipts.finalize(receipt.id, {
      exitCode: 0,
      durationMs: 0,
      parsedJson: {
        templateId,
        templateName: importData.name,
        fileCount: fileNames.length,
        isValid: newTemplate?.isValid ?? false,
      },
    })

    return NextResponse.json({
      data: newTemplate || {
        id: templateId,
        name: importData.name,
        version: importData.version,
        isValid: true,
        fileCount: fileNames.length,
      },
      validation: {
        valid: validation.valid,
        errors: validation.errors,
        warnings: validation.warnings,
      },
      receiptId: receipt.id,
    })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to import template'

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
