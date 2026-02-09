import { NextRequest, NextResponse } from 'next/server'
import { promises as fsp } from 'node:fs'
import { dirname } from 'node:path'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { getRepos } from '@/lib/repo'
import { validateWorkspacePath } from '@/lib/fs/path-policy'
import { scanTemplates } from '@/lib/templates'
import {
  TemplateImportError,
  prepareTemplateImportBundleFromFormData,
  prepareTemplateImportBundleFromJsonBody,
} from '@/lib/template-import'

interface ImportValidationResult {
  templateId: string
  valid: boolean
  errors: Array<{ path: string; message: string; code: string }>
  warnings: Array<{ path: string; message: string; code: string }>
}

function toErrorPayload(err: unknown): { status: number; body: Record<string, unknown> } {
  if (err instanceof TemplateImportError) {
    const body: Record<string, unknown> = { error: err.message }
    if (err.details) {
      Object.assign(body, err.details)
    }
    return { status: err.status, body }
  }

  const message = err instanceof Error ? err.message : 'Failed to import template'
  return { status: 500, body: { error: message } }
}

function templateWorkspacePath(templateId: string): string {
  return `/agent-templates/${templateId}`
}

async function templateExists(templateId: string): Promise<boolean> {
  const templatePath = templateWorkspacePath(templateId)
  const dirRes = validateWorkspacePath(templatePath)
  if (!dirRes.valid || !dirRes.resolvedPath) {
    throw new Error(dirRes.error || `Invalid template path: ${templatePath}`)
  }

  try {
    await fsp.access(dirRes.resolvedPath)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw err
  }
}

/**
 * POST /api/agent-templates/import
 * Import one template from JSON or one/many templates from ZIP bundle.
 */
export async function POST(request: NextRequest) {
  const contentType = (request.headers.get('content-type') || '').toLowerCase()

  let parsed: Awaited<ReturnType<typeof prepareTemplateImportBundleFromFormData>> | ReturnType<typeof prepareTemplateImportBundleFromJsonBody>

  try {
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      parsed = await prepareTemplateImportBundleFromFormData(formData)
    } else if (contentType.includes('application/json') || contentType === '') {
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
      }
      parsed = prepareTemplateImportBundleFromJsonBody(body)
    } else {
      return NextResponse.json(
        { error: 'Unsupported content type. Use application/json or multipart/form-data.' },
        { status: 415 }
      )
    }
  } catch (err) {
    const { status, body } = toErrorPayload(err)
    return NextResponse.json(body, { status })
  }

  const { bundle, typedConfirmText } = parsed

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

  // Detect template conflicts before writing to enforce all-or-nothing semantics.
  const existingTemplateIds = (
    await Promise.all(
      bundle.templateIds.map(async (templateId) => (await templateExists(templateId)) ? templateId : null)
    )
  ).filter((value): value is string => Boolean(value))

  if (existingTemplateIds.length > 0) {
    return NextResponse.json(
      {
        error: `Template conflict: already exists (${existingTemplateIds.join(', ')})`,
        existingTemplateIds,
      },
      { status: 409 }
    )
  }

  const repos = getRepos()

  // Create receipt for the operation
  const receipt = await repos.receipts.create({
    workOrderId: 'system',
    kind: 'manual',
    commandName: 'template.import',
    commandArgs: {
      templateCount: bundle.templateCount,
      templateIds: bundle.templateIds,
      source: bundle.source,
      layout: bundle.layout,
      fileName: bundle.fileName ?? null,
    },
  })

  const createdTemplateDirs: string[] = []

  try {
    await repos.receipts.append(receipt.id, {
      stream: 'stdout',
      chunk: `Importing ${bundle.templateCount} template(s): ${bundle.templateIds.join(', ')}\n`,
    })

    const templatesBaseRes = validateWorkspacePath('/agent-templates')
    if (!templatesBaseRes.valid || !templatesBaseRes.resolvedPath) {
      throw new Error(templatesBaseRes.error || 'Invalid templates base path')
    }
    await fsp.mkdir(templatesBaseRes.resolvedPath, { recursive: true })

    for (const template of bundle.templates) {
      const templatePath = templateWorkspacePath(template.templateId)
      const dirRes = validateWorkspacePath(templatePath)
      if (!dirRes.valid || !dirRes.resolvedPath) {
        throw new Error(dirRes.error || `Invalid template path: ${templatePath}`)
      }

      // Re-check at write-time to avoid races.
      try {
        await fsp.access(dirRes.resolvedPath)
        throw new Error(`Template "${template.templateId}" already exists`)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err
        }
      }

      await fsp.mkdir(dirRes.resolvedPath, { recursive: false })
      createdTemplateDirs.push(dirRes.resolvedPath)

      await repos.receipts.append(receipt.id, {
        stream: 'stdout',
        chunk: `  Created folder: ${templatePath}\n`,
      })

      const fileNames = Object.keys(template.files).sort((left, right) => left.localeCompare(right))
      for (const fileName of fileNames) {
        const parts = fileName.split('/')
        if (parts.some((part) => part === '' || part === '.' || part === '..')) {
          throw new Error(`Invalid file name: ${fileName}`)
        }
        if (parts.some((part) => part.startsWith('.'))) {
          throw new Error(`Invalid file name (hidden path segment): ${fileName}`)
        }

        const content = template.files[fileName]
        const filePath = `${templatePath}/${fileName}`
        const fileRes = validateWorkspacePath(filePath)
        if (!fileRes.valid || !fileRes.resolvedPath) {
          throw new Error(fileRes.error || `Invalid file path: ${filePath}`)
        }

        await fsp.mkdir(dirname(fileRes.resolvedPath), { recursive: true })
        await fsp.writeFile(fileRes.resolvedPath, content, 'utf8')

        await repos.receipts.append(receipt.id, {
          stream: 'stdout',
          chunk: `  Created file: ${template.templateId}/${fileName} (${Buffer.byteLength(content, 'utf8')} bytes)\n`,
        })
      }
    }

    // Rescan templates to pick up all imports
    const updatedTemplates = await scanTemplates()

    const importedTemplates = bundle.templates.map((template) => {
      const scanned = updatedTemplates.find((item) => item.id === template.templateId)
      if (scanned) {
        return {
          id: scanned.id,
          name: scanned.name,
          version: scanned.version,
          isValid: scanned.isValid,
          fileCount: Object.keys(template.files).length,
        }
      }

      return {
        id: template.templateId,
        name: template.name,
        version: template.version,
        isValid: true,
        fileCount: Object.keys(template.files).length,
      }
    })

    const validationResults: ImportValidationResult[] = bundle.templates.map((template) => ({
      templateId: template.templateId,
      valid: template.validation.valid,
      errors: template.validation.errors,
      warnings: template.validation.warnings,
    }))

    for (const template of bundle.templates) {
      await repos.activities.create({
        type: 'template.imported',
        actor: 'user',
        entityType: 'template',
        entityId: template.templateId,
        summary: `Imported template ${template.name}`,
        payloadJson: {
          templateId: template.templateId,
          templateName: template.name,
          fileCount: Object.keys(template.files).length,
          exportedAt: template.exportedAt ?? null,
          source: bundle.source,
          layout: bundle.layout,
          bundleTemplateCount: bundle.templateCount,
          bundleTemplateIds: bundle.templateIds,
        },
      })
    }

    await repos.receipts.finalize(receipt.id, {
      exitCode: 0,
      durationMs: 0,
      parsedJson: {
        templateCount: bundle.templateCount,
        templateIds: bundle.templateIds,
        importedTemplates,
        source: bundle.source,
        layout: bundle.layout,
      },
    })

    return NextResponse.json({
      data: importedTemplates[0],
      importedTemplates,
      importSummary: {
        templateCount: bundle.templateCount,
        templateIds: bundle.templateIds,
        source: bundle.source,
        layout: bundle.layout,
      },
      validation: validationResults[0],
      validations: validationResults,
      receiptId: receipt.id,
    })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to import template'

    if (createdTemplateDirs.length > 0) {
      for (const absDir of [...createdTemplateDirs].reverse()) {
        try {
          await fsp.rm(absDir, { recursive: true, force: true })
          await repos.receipts.append(receipt.id, {
            stream: 'stdout',
            chunk: `Rolled back folder: ${absDir}\n`,
          })
        } catch (rollbackErr) {
          await repos.receipts.append(receipt.id, {
            stream: 'stderr',
            chunk: `Rollback failed for ${absDir}: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}\n`,
          })
        }
      }
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

    const status = errorMessage.includes('already exists') ? 409 : 500

    return NextResponse.json(
      { error: errorMessage, receiptId: receipt.id },
      { status }
    )
  }
}
