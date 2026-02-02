import { NextRequest, NextResponse } from 'next/server'
import { mockPlaybooks } from '@savorgos/core'
import { enforceTypedConfirm } from '@/lib/with-governor'
import type { ActionKind } from '@savorgos/core'

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

  const playbook = mockPlaybooks.find((p) => p.id === id)
  if (!playbook) {
    return NextResponse.json({ error: 'Playbook not found' }, { status: 404 })
  }

  return NextResponse.json({ data: playbook })
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

  const playbookIndex = mockPlaybooks.findIndex((p) => p.id === id)
  if (playbookIndex === -1) {
    return NextResponse.json({ error: 'Playbook not found' }, { status: 404 })
  }

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

  // Update the playbook content (in-memory mock)
  mockPlaybooks[playbookIndex] = {
    ...mockPlaybooks[playbookIndex],
    content,
    modifiedAt: new Date(),
  }

  return NextResponse.json({
    data: mockPlaybooks[playbookIndex],
  })
}
