import { NextRequest, NextResponse } from 'next/server'
import { mockWorkspaceFiles, mockFileContents } from '@savorg/core'
import { enforceTypedConfirm } from '@/lib/with-governor'
import type { ActionKind } from '@savorg/core'
import { useMockData } from '@/lib/repo'
import { readWorkspaceFileById, writeWorkspaceFileById, deleteWorkspaceEntry } from '@/lib/fs/workspace-fs'

// Protected file mapping
const PROTECTED_FILES: Record<string, ActionKind> = {
  'AGENTS.md': 'config.agents_md.edit',
  'routing.yaml': 'config.routing_template.edit',
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

  // Mock mode uses in-memory files; DB mode reads from disk
  if (useMockData()) {
    const file = mockWorkspaceFiles.find((f) => f.id === id)
    if (!file) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    if (file.type === 'folder') {
      return NextResponse.json({ error: 'Cannot read folder content' }, { status: 400 })
    }

    const content = mockFileContents[id] ?? ''

    return NextResponse.json({
      data: {
        ...file,
        content,
      },
    })
  }

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
  const fileName = useMockData()
    ? mockWorkspaceFiles.find((f) => f.id === id)?.name
    : (() => {
        try {
          // id encodes full path; take last segment
          const decoded = Buffer.from(id, 'base64url').toString('utf8')
          return decoded.split('/').filter(Boolean).pop()
        } catch {
          return undefined
        }
      })()

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

  if (useMockData()) {
    const file = mockWorkspaceFiles.find((f) => f.id === id)
    if (!file) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    if (file.type === 'folder') {
      return NextResponse.json({ error: 'Cannot write to folder' }, { status: 400 })
    }

    mockFileContents[id] = content

    return NextResponse.json({
      data: {
        ...file,
        content,
        modifiedAt: new Date(),
      },
    })
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
  const fileName = useMockData()
    ? mockWorkspaceFiles.find((f) => f.id === id)?.name
    : (() => {
        try {
          const decoded = Buffer.from(id, 'base64url').toString('utf8')
          return decoded.split('/').filter(Boolean).pop()
        } catch {
          return undefined
        }
      })()

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

  if (useMockData()) {
    const fileIndex = mockWorkspaceFiles.findIndex((f) => f.id === id)
    if (fileIndex === -1) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    mockWorkspaceFiles.splice(fileIndex, 1)
    if (mockFileContents[id]) {
      delete mockFileContents[id]
    }

    return NextResponse.json({ success: true })
  }

  try {
    await deleteWorkspaceEntry(id)
    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to delete'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
