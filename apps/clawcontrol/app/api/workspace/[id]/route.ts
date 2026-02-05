import { NextRequest, NextResponse } from 'next/server'
import { enforceTypedConfirm } from '@/lib/with-governor'
import type { ActionKind } from '@clawcontrol/core'
import { readWorkspaceFileById, writeWorkspaceFileById, deleteWorkspaceEntry } from '@/lib/fs/workspace-fs'

// Protected file mapping
const PROTECTED_FILES: Record<string, ActionKind> = {
  'AGENTS.md': 'config.agents_md.edit',
  'routing.yaml': 'config.routing_template.edit',
}

function getFileNameFromWorkspaceId(id: string): string | undefined {
  try {
    const decoded = Buffer.from(id, 'base64url').toString('utf8')
    return decoded.split('/').filter(Boolean).pop()
  } catch {
    return undefined
  }
}

/**
 * GET /api/workspace/:id
 * Read file content
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const file = await readWorkspaceFileById(id)
    return NextResponse.json({ data: file })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to read file'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}

/**
 * PUT /api/workspace/:id
 * Update file content (with Governor gating for protected files)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const body = await request.json()
  const { content, typedConfirmText } = body

  if (typeof content !== 'string') {
    return NextResponse.json({ error: 'Content is required' }, { status: 400 })
  }

  // Determine file name for protected-file gating
  const fileName = getFileNameFromWorkspaceId(id)

  // Check if this is a protected file
  const actionKind = fileName ? PROTECTED_FILES[fileName] : undefined

  if (actionKind) {
    const result = await enforceTypedConfirm({
      actionKind,
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
  }

  try {
    const file = await writeWorkspaceFileById(id, content)
    return NextResponse.json({ data: file })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to write file'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}

// Deleting files is a danger-level action (protected files are not deletable)
const DELETE_ACTION: ActionKind = 'action.danger'

/**
 * DELETE /api/workspace/:id
 * Delete file or folder (with Governor gating)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const body = await request.json().catch(() => ({}))
  const { typedConfirmText } = body as { typedConfirmText?: string }

  // Determine file name for protected-file check
  const fileName = getFileNameFromWorkspaceId(id)

  // Protected files cannot be deleted
  if (fileName && PROTECTED_FILES[fileName]) {
    return NextResponse.json(
      { error: 'Protected files cannot be deleted' },
      { status: 403 }
    )
  }

  // Enforce typed confirmation for deletion
  const result = await enforceTypedConfirm({
    actionKind: DELETE_ACTION,
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

  try {
    await deleteWorkspaceEntry(id)
    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to delete'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
