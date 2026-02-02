import { NextRequest, NextResponse } from 'next/server'
import {
  mockGlobalSkills,
  mockAgentSkills,
  mockSkillContents,
  mockAgents,
} from '@savorgos/core'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { validateSkill } from '@/lib/skill-validator'
import { getRepos } from '@/lib/repo'
import type { ActionKind, SkillScope, Skill } from '@savorgos/core'

/**
 * POST /api/skills/:scope/:id/duplicate
 * Duplicate/copy a skill to another scope
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ scope: string; id: string }> }
) {
  const { scope, id } = await params

  if (!['global', 'agent'].includes(scope)) {
    return NextResponse.json({ error: 'Invalid scope' }, { status: 400 })
  }

  const sourceSkills = scope === 'global' ? mockGlobalSkills : mockAgentSkills
  const sourceSkill = sourceSkills.find((s) => s.id === id)

  if (!sourceSkill) {
    return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
  }

  const body = await request.json()
  const { targetScope, targetAgentId, newName, typedConfirmText } = body

  // Validate target scope
  if (!targetScope || !['global', 'agent'].includes(targetScope)) {
    return NextResponse.json({ error: 'Valid target scope is required' }, { status: 400 })
  }

  // Validate agent ID for agent scope
  if (targetScope === 'agent' && !targetAgentId) {
    return NextResponse.json({ error: 'Agent ID is required for agent scope' }, { status: 400 })
  }

  // Validate agent exists
  if (targetScope === 'agent') {
    const agent = mockAgents.find((a) => a.id === targetAgentId)
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }
  }

  // Determine skill name
  const skillName = newName || `${sourceSkill.name}-copy`

  // Check if name is valid
  const safeNameRegex = /^[a-z0-9][a-z0-9-_]{1,48}$/
  if (!safeNameRegex.test(skillName)) {
    return NextResponse.json(
      { error: 'Invalid skill name. Use lowercase letters, numbers, hyphens and underscores.' },
      { status: 400 }
    )
  }

  // Check for existing skill with same name in target scope
  const targetSkills = targetScope === 'global' ? mockGlobalSkills : mockAgentSkills
  const exists = targetSkills.some(
    (s) => s.name === skillName && (targetScope === 'global' || s.agentId === targetAgentId)
  )
  if (exists) {
    return NextResponse.json({ error: 'Skill with this name already exists in target scope' }, { status: 409 })
  }

  // Determine action kind based on direction
  let actionKind: ActionKind
  if (targetScope === 'global') {
    actionKind = 'skill.duplicate_to_global' // danger level
  } else {
    actionKind = 'skill.duplicate_to_agent' // caution level
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

  // Get source content
  const sourceContent = mockSkillContents[id]

  // Validate the skill before copying
  const validationResult = validateSkill({
    name: skillName,
    files: {
      skillMd: sourceContent?.skillMd,
      config: sourceContent?.config,
    },
    hasEntrypoint: sourceSkill.hasEntrypoint,
  })

  // Create new skill
  const newSkill: Skill = {
    id: `skill_${targetScope === 'global' ? 'g' : 'a'}_${Date.now()}`,
    name: skillName,
    description: sourceSkill.description,
    version: sourceSkill.version,
    scope: targetScope as SkillScope,
    agentId: targetScope === 'agent' ? targetAgentId : undefined,
    enabled: false, // Start disabled
    usageCount: 0,
    lastUsedAt: null,
    installedAt: new Date(),
    modifiedAt: new Date(),
    hasConfig: sourceSkill.hasConfig,
    hasEntrypoint: sourceSkill.hasEntrypoint,
    validation: validationResult,
  }

  // Add to target array
  if (targetScope === 'global') {
    mockGlobalSkills.push(newSkill)
  } else {
    mockAgentSkills.push(newSkill)
  }

  // Copy content
  if (sourceContent) {
    mockSkillContents[newSkill.id] = { ...sourceContent }
  }

  // Log activity
  const repos = getRepos()
  await repos.activities.create({
    type: 'skill.duplicated',
    actor: 'user',
    entityType: 'skill',
    entityId: newSkill.id,
    summary: `Duplicated skill: ${sourceSkill.name} → ${skillName}`,
    payloadJson: {
      sourceScope: scope,
      sourceId: id,
      targetScope,
      targetAgentId: targetScope === 'agent' ? targetAgentId : null,
      validationStatus: validationResult.status,
    },
  })

  // Get agent name for response
  let agentName: string | undefined
  if (targetScope === 'agent' && targetAgentId) {
    const agent = mockAgents.find((a) => a.id === targetAgentId)
    agentName = agent?.name
  }

  return NextResponse.json({
    data: {
      ...newSkill,
      agentName,
    },
  }, { status: 201 })
}
