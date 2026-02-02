import { NextRequest, NextResponse } from 'next/server'
import { mockWorkspaceFiles, mockFileContents } from '@savorgos/core'
import { enforceTypedConfirm } from '@/lib/with-governor'
import type { ActionKind } from '@savorgos/core'

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

/**
 * PUT /api/workspace/:id
 * Update file content (with Governor gating for protected files)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const file = mockWorkspaceFiles.find((f) => f.id === id)
  if (!file) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  if (file.type === 'folder') {
    return NextResponse.json({ error: 'Cannot write to folder' }, { status: 400 })
  }

  const body = await request.json()
  const { content, typedConfirmText } = body

  if (typeof content !== 'string') {
    return NextResponse.json({ error: 'Content is required' }, { status: 400 })
  }

  // Check if this is a protected file
  const actionKind = PROTECTED_FILES[file.name]

  if (actionKind) {
    // Enforce typed confirmation for protected files
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

  // Update mock content (in real implementation, write to disk)
  mockFileContents[id] = content

  return NextResponse.json({
    data: {
      ...file,
      content,
      modifiedAt: new Date(),
    },
  })
}
