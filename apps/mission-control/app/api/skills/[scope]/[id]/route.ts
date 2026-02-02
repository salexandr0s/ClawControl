import { NextRequest, NextResponse } from 'next/server'
import {
  mockGlobalSkills,
  mockAgentSkills,
  mockSkillContents,
  mockAgents,
} from '@savorgos/core'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { validateSkill, requiresEnableOverride } from '@/lib/skill-validator'
import { getRepos } from '@/lib/repo'
import type { ActionKind, SkillScope, Skill } from '@savorgos/core'

function getSkillsArray(scope: SkillScope) {
  return scope === 'global' ? mockGlobalSkills : mockAgentSkills
}

function findSkill(scope: SkillScope, id: string): Skill | undefined {
  return getSkillsArray(scope).find((s) => s.id === id)
}

function findSkillIndex(scope: SkillScope, id: string): number {
  return getSkillsArray(scope).findIndex((s) => s.id === id)
}

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

  const skill = findSkill(scope as SkillScope, id)
  if (!skill) {
    return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
  }

  // Get content if available
  const content = mockSkillContents[id]

  // Get agent name for agent-scoped skills
  let agentName: string | undefined
  if (skill.scope === 'agent' && skill.agentId) {
    const agent = mockAgents.find((a) => a.id === skill.agentId)
    agentName = agent?.name
  }

  return NextResponse.json({
    data: {
      ...skill,
      agentName,
      skillMd: content?.skillMd ?? '',
      config: content?.config,
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

  const skillsArray = getSkillsArray(scope as SkillScope)
  const skillIndex = findSkillIndex(scope as SkillScope, id)

  if (skillIndex === -1) {
    return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
  }

  const body = await request.json()
  const { enabled, skillMd, config, typedConfirmText, forceEnableInvalid } = body

  const skill = skillsArray[skillIndex]

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

  // Update enabled state
  if (typeof enabled === 'boolean') {
    skillsArray[skillIndex] = {
      ...skill,
      enabled,
      modifiedAt: new Date(),
    }

    // Log activity
    const repos = getRepos()
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

  // Update content and re-validate
  if (typeof skillMd === 'string' || typeof config === 'string') {
    const existingContent = mockSkillContents[id] ?? { skillMd: '' }
    mockSkillContents[id] = {
      skillMd: typeof skillMd === 'string' ? skillMd : existingContent.skillMd,
      config: typeof config === 'string' ? config : existingContent.config,
    }

    // Re-validate the skill after content update
    const validationResult = validateSkill({
      name: skill.name,
      files: {
        skillMd: mockSkillContents[id].skillMd,
        config: mockSkillContents[id].config,
      },
      hasEntrypoint: skill.hasEntrypoint,
    })

    skillsArray[skillIndex] = {
      ...skillsArray[skillIndex],
      hasConfig: !!mockSkillContents[id].config,
      modifiedAt: new Date(),
      validation: validationResult,
    }

    // Log activity
    const repos = getRepos()
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
        validationStatus: validationResult.status,
      },
    })
  }

  // Return updated skill with content
  const updatedSkill = skillsArray[skillIndex]
  const content = mockSkillContents[id]

  return NextResponse.json({
    data: {
      ...updatedSkill,
      skillMd: content?.skillMd ?? '',
      config: content?.config,
    },
  })
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

  const skillsArray = getSkillsArray(scope as SkillScope)
  const skillIndex = findSkillIndex(scope as SkillScope, id)

  if (skillIndex === -1) {
    return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
  }

  const skill = skillsArray[skillIndex]

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
  const result = await enforceTypedConfirm({
    actionKind: ACTION_KIND,
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

  // Remove skill from array
  skillsArray.splice(skillIndex, 1)

  // Remove content if exists
  if (mockSkillContents[id]) {
    delete mockSkillContents[id]
  }

  // Log activity
  const repos = getRepos()
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
}
