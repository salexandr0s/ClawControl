import { NextRequest, NextResponse } from 'next/server'
import { listWorkspace, createWorkspaceFile, createWorkspaceFolder } from '@/lib/fs/workspace-fs'
import { enforceTypedConfirm } from '@/lib/with-governor'
import type { ActionKind } from '@clawcontrol/core'

// Creating files is a caution-level action
const CREATE_ACTION: ActionKind = 'action.caution'

/**
 * GET /api/workspace?path=/agents
 * List workspace directory entries.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const path = searchParams.get('path') || '/'

  try {
    const data = await listWorkspace(path)
    return NextResponse.json({ data })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to list workspace'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}

/**
 * POST /api/workspace
 * Create a new file or folder.
 */
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { path, name, type, content, typedConfirmText } = body as {
    path: string
    name: string
    type: 'file' | 'folder'
    content?: string
    typedConfirmText?: string
  }

  if (!path || !name || !type) {
    return NextResponse.json(
      { error: 'path, name, and type are required' },
      { status: 400 }
    )
  }

  // Validate name (no slashes, no dots at start)
  if (name.includes('/') || name.startsWith('.')) {
    return NextResponse.json(
      { error: 'Invalid name' },
      { status: 400 }
    )
  }

  // Enforce typed confirmation
  const result = await enforceTypedConfirm({
    actionKind: CREATE_ACTION,
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
    if (type === 'folder') {
      const entry = await createWorkspaceFolder(path, name)
      return NextResponse.json({ data: entry })
    } else {
      const entry = await createWorkspaceFile(path, name, content ?? '')
      return NextResponse.json({ data: entry })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create entry'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
