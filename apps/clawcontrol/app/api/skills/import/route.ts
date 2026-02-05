import { NextRequest, NextResponse } from 'next/server'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { getRepos } from '@/lib/repo'
import type { ActionKind } from '@clawcontrol/core'
import type { SkillScope } from '@/lib/repo'

/**
 * POST /api/skills/import
 * Import a skill from a ZIP file (with Governor gating)
 */
export async function POST(request: NextRequest) {
  const formData = await request.formData()

  const fileEntry = formData.get('file')
  const scopeEntry = formData.get('scope')
  const agentIdEntry = formData.get('agentId')
  const typedConfirmEntry = formData.get('typedConfirmText')

  if (!(fileEntry instanceof File) || !fileEntry.name.toLowerCase().endsWith('.zip')) {
    return NextResponse.json({ error: 'ZIP file required' }, { status: 400 })
  }

  const scope = typeof scopeEntry === 'string' ? scopeEntry : null
  if (!scope || !['global', 'agent'].includes(scope)) {
    return NextResponse.json({ error: 'Valid scope (global/agent) is required' }, { status: 400 })
  }

  const agentId = typeof agentIdEntry === 'string' && agentIdEntry.trim() ? agentIdEntry.trim() : undefined
  if (scope === 'agent' && !agentId) {
    return NextResponse.json({ error: 'Agent ID is required for agent-scoped skills' }, { status: 400 })
  }

  const typedConfirmText = typeof typedConfirmEntry === 'string' ? typedConfirmEntry : undefined

  // Enforce Governor - skill.install is danger level
  const ACTION_KIND: ActionKind = 'skill.install'
  const enforcement = await enforceTypedConfirm({
    actionKind: ACTION_KIND,
    typedConfirmText,
  })

  if (!enforcement.allowed) {
    return NextResponse.json(
      {
        error: enforcement.errorType,
        policy: enforcement.policy,
      },
      { status: enforcement.errorType === 'TYPED_CONFIRM_REQUIRED' ? 428 : 403 }
    )
  }

  const repos = getRepos()

  try {
    const imported = await repos.skills.importZip(fileEntry, {
      scope: scope as SkillScope,
      ...(scope === 'agent' ? { agentId } : {}),
    })

    await repos.activities.create({
      type: 'skill.installed',
      actor: 'user',
      entityType: 'skill',
      entityId: imported.id,
      summary: `Imported skill: ${imported.name}`,
      payloadJson: {
        scope,
        agentId: scope === 'agent' ? agentId : null,
        version: imported.version,
        source: 'zip',
        originalFileName: fileEntry.name,
      },
    })

    return NextResponse.json({ data: imported }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to import skill'
    const status = message.includes('already exists')
      ? 409
      : message.toLowerCase().includes('invalid')
        ? 400
        : 500

    return NextResponse.json({ error: message }, { status })
  }
}

