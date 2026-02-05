import { NextRequest, NextResponse } from 'next/server'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { getPlaybook, updatePlaybook } from '@/lib/fs/playbooks-fs'
import type { ActionKind } from '@clawcontrol/core'

// Playbook edit action - uses caution level
const PLAYBOOK_ACTION: ActionKind = 'action.caution'

/**
 * GET /api/playbooks/:id
 * Get playbook details with content
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const playbook = await getPlaybook(id)
    if (!playbook) {
      return NextResponse.json({ error: 'Playbook not found' }, { status: 404 })
    }
    return NextResponse.json({ data: playbook })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to read playbook'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/**
 * PUT /api/playbooks/:id
 * Update playbook content (with Governor gating)
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

  // Enforce typed confirmation for playbook edits
  const result = await enforceTypedConfirm({
    actionKind: PLAYBOOK_ACTION,
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
    const playbook = await updatePlaybook(id, content)
    if (!playbook) {
      return NextResponse.json({ error: 'Playbook not found' }, { status: 404 })
    }
    return NextResponse.json({ data: playbook })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to update playbook'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
