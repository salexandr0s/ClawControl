import { NextRequest, NextResponse } from 'next/server'
import { enforceActionPolicy } from '@/lib/with-governor'
import { requiresEnableOverride } from '@/lib/skill-validator'
import { getRepos } from '@/lib/repo'
import type { ActionKind } from '@clawcontrol/core'
import type { SkillScope } from '@/lib/repo'

/**
 * GET /api/skills/:scope/:id
 * Get skill details with content
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ scope: string; id: string }> }
) {
  const { scope, id } = await params

  if (!['global', 'agent'].includes(scope)) {
    return NextResponse.json({ error: 'Invalid scope' }, { status: 400 })
  }

  const repos = getRepos()
  const skill = await repos.skills.getById(scope as SkillScope, id)

  if (!skill) {
    return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
  }

  const scopeKey = scope === 'global' ? '__global__' : (skill.agentId ?? '')
  let marketplace: {
    provider: 'clawhub'
    slug: string
    scope: 'global' | 'agent'
    scopeKey: string
    version: string
    sourceUrl: string
    installMethod: string
    manifestHash: string | null
    installedAt: Date
    installedBy: string
    lastReceiptId: string | null
  } | null = null

  if (scopeKey) {
    try {
      const installs = await repos.clawhubInstalls.listActiveBySlug(skill.name)
      const match = installs.find((i) => i.scope === scope && i.scopeKey === scopeKey) ?? null
      if (match) {
        marketplace = {
          provider: 'clawhub',
          slug: match.slug,
          scope: match.scope,
          scopeKey: match.scopeKey,
          version: match.version,
          sourceUrl: match.sourceUrl,
          installMethod: match.installMethod,
          manifestHash: match.manifestHash,
          installedAt: match.installedAt,
          installedBy: match.installedBy,
          lastReceiptId: match.lastReceiptId,
        }
      }
    } catch {
      // If clawhub install tracking table doesn't exist (pre-migration DB), omit marketplace metadata.
    }
  }

  return NextResponse.json({
    data: {
      ...skill,
      marketplace,
    },
  })
}

/**
 * PUT /api/skills/:scope/:id
 * Update skill (enable/disable/edit content)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ scope: string; id: string }> }
) {
  const { scope, id } = await params

  if (!['global', 'agent'].includes(scope)) {
    return NextResponse.json({ error: 'Invalid scope' }, { status: 400 })
  }

  const repos = getRepos()
  const skill = await repos.skills.getById(scope as SkillScope, id)

  if (!skill) {
    return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
  }

  const body = await request.json()
  const { enabled, skillMd, config, typedConfirmText, forceEnableInvalid } = body

  // Determine action kind based on what's being updated
  let actionKind: ActionKind = 'skill.edit'
  if (typeof enabled === 'boolean') {
    // Check if trying to enable an invalid skill
    if (enabled && requiresEnableOverride(skill.validation)) {
      if (!forceEnableInvalid) {
        return NextResponse.json(
          {
            error: 'ENABLE_INVALID_SKILL',
            message: 'Cannot enable a skill with validation errors. Use forceEnableInvalid to override.',
            validation: skill.validation,
          },
          { status: 422 }
        )
      }
      // Force enable requires danger-level confirmation
      actionKind = 'skill.enable_invalid'
    } else {
      actionKind = enabled ? 'skill.enable' : 'skill.disable'
    }
  }

  // Enforce Governor
  const result = await enforceActionPolicy({
    actionKind,
    typedConfirmText,
  })

  if (!result.allowed) {
    return NextResponse.json(
      {
        error: result.errorType,
        policy: result.policy,
      },
      { status: result.status ?? (result.errorType === 'TYPED_CONFIRM_REQUIRED' ? 428 : 403) }
    )
  }

  try {
    // Update skill via repo
    const updatedSkill = await repos.skills.update(scope as SkillScope, id, {
      enabled: typeof enabled === 'boolean' ? enabled : undefined,
      skillMd: typeof skillMd === 'string' ? skillMd : undefined,
      config: typeof config === 'string' ? config : undefined,
    })

    if (!updatedSkill) {
      return NextResponse.json({ error: 'Failed to update skill' }, { status: 500 })
    }

    // Log activity based on what was changed
    if (typeof enabled === 'boolean') {
      await repos.activities.create({
        type: enabled ? 'skill.enabled' : 'skill.disabled',
        actor: 'user',
        entityType: 'skill',
        entityId: id,
        summary: `${enabled ? 'Enabled' : 'Disabled'} skill: ${skill.name}`,
        payloadJson: {
          scope,
          enabled,
          forceEnableInvalid: forceEnableInvalid ?? false,
        },
      })
    }

    if (typeof skillMd === 'string' || typeof config === 'string') {
      await repos.activities.create({
        type: 'skill.updated',
        actor: 'user',
        entityType: 'skill',
        entityId: id,
        summary: `Updated skill: ${skill.name}`,
        payloadJson: {
          scope,
          updatedFields: [
            ...(typeof skillMd === 'string' ? ['skillMd'] : []),
            ...(typeof config === 'string' ? ['config'] : []),
          ],
        },
      })
    }

    // Re-fetch to get updated content
    const finalSkill = await repos.skills.getById(scope as SkillScope, id)
    return NextResponse.json({ data: finalSkill })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update skill'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * DELETE /api/skills/:scope/:id
 * Uninstall a skill (with Governor gating)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ scope: string; id: string }> }
) {
  const { scope, id } = await params

  if (!['global', 'agent'].includes(scope)) {
    return NextResponse.json({ error: 'Invalid scope' }, { status: 400 })
  }

  const repos = getRepos()
  const skill = await repos.skills.getById(scope as SkillScope, id)

  if (!skill) {
    return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
  }

  // Get typed confirm from body
  let typedConfirmText: string | undefined
  try {
    const body = await request.json()
    typedConfirmText = body.typedConfirmText
  } catch {
    // Body might be empty
  }

  // Enforce Governor - skill.uninstall is danger level
  const ACTION_KIND: ActionKind = 'skill.uninstall'
  const result = await enforceActionPolicy({
    actionKind: ACTION_KIND,
    typedConfirmText,
  })

  if (!result.allowed) {
    return NextResponse.json(
      {
        error: result.errorType,
        policy: result.policy,
      },
      { status: result.status ?? (result.errorType === 'TYPED_CONFIRM_REQUIRED' ? 428 : 403) }
    )
  }

  try {
    // Delete skill via repo
    const deleted = await repos.skills.delete(scope as SkillScope, id)

    if (!deleted) {
      return NextResponse.json({ error: 'Failed to delete skill' }, { status: 500 })
    }

    // Log activity
    await repos.activities.create({
      type: 'skill.removed',
      actor: 'user',
      entityType: 'skill',
      entityId: id,
      summary: `Uninstalled skill: ${skill.name}`,
      payloadJson: {
        scope,
        skillName: skill.name,
        version: skill.version,
      },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete skill'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
