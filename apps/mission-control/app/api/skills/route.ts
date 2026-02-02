import { NextRequest, NextResponse } from 'next/server'
import { mockGlobalSkills, mockAgentSkills, mockAgents } from '@savorgos/core'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { getRepos } from '@/lib/repo'
import type { ActionKind, SkillScope } from '@savorgos/core'

/**
 * GET /api/skills
 * List all skills (global + agent-scoped)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const scope = searchParams.get('scope') as SkillScope | null
  const agentId = searchParams.get('agentId')

  let skills = [...mockGlobalSkills, ...mockAgentSkills]

  // Filter by scope
  if (scope === 'global') {
    skills = skills.filter((s) => s.scope === 'global')
  } else if (scope === 'agent') {
    skills = skills.filter((s) => s.scope === 'agent')
    // Further filter by agentId if provided
    if (agentId) {
      skills = skills.filter((s) => s.agentId === agentId)
    }
  }

  // Get agent names for agent-scoped skills
  const skillsWithAgentNames = skills.map((skill) => {
    if (skill.scope === 'agent' && skill.agentId) {
      const agent = mockAgents.find((a) => a.id === skill.agentId)
      return {
        ...skill,
        agentName: agent?.name ?? 'Unknown',
      }
    }
    return skill
  })

  return NextResponse.json({ data: skillsWithAgentNames })
}

/**
 * POST /api/skills
 * Install a new skill (with Governor gating)
 */
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { name, description, scope, agentId, typedConfirmText } = body

  // Validate required fields
  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'Skill name is required' }, { status: 400 })
  }

  if (!scope || !['global', 'agent'].includes(scope)) {
    return NextResponse.json({ error: 'Valid scope (global/agent) is required' }, { status: 400 })
  }

  if (scope === 'agent' && !agentId) {
    return NextResponse.json({ error: 'Agent ID is required for agent-scoped skills' }, { status: 400 })
  }

  // Validate skill name (path safety)
  const safeNameRegex = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/
  if (!safeNameRegex.test(name) || name.includes('..') || name.startsWith('-') || name.endsWith('-')) {
    return NextResponse.json(
      { error: 'Invalid skill name. Use lowercase letters, numbers, and hyphens only.' },
      { status: 400 }
    )
  }

  // Check for existing skill with same name
  const existingSkills = scope === 'global' ? mockGlobalSkills : mockAgentSkills
  const exists = existingSkills.some(
    (s) => s.name === name && (scope === 'global' || s.agentId === agentId)
  )
  if (exists) {
    return NextResponse.json({ error: 'Skill with this name already exists' }, { status: 409 })
  }

  // Enforce Governor - skill.install is danger level
  const ACTION_KIND: ActionKind = 'skill.install'
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

  // Create new skill
  const newSkill = {
    id: `skill_${scope === 'global' ? 'g' : 'a'}_${Date.now()}`,
    name,
    description: description || '',
    version: '1.0.0',
    scope: scope as SkillScope,
    agentId: scope === 'agent' ? agentId : undefined,
    enabled: true,
    usageCount: 0,
    lastUsedAt: null,
    installedAt: new Date(),
    modifiedAt: new Date(),
    hasConfig: false,
    hasEntrypoint: false,
  }

  // Add to mock data (in real implementation, write to disk)
  if (scope === 'global') {
    mockGlobalSkills.push(newSkill)
  } else {
    mockAgentSkills.push(newSkill)
  }

  // Log activity
  const repos = getRepos()
  await repos.activities.create({
    type: 'skill.installed',
    actor: 'user',
    entityType: 'skill',
    entityId: newSkill.id,
    summary: `Installed skill: ${name}`,
    payloadJson: {
      scope,
      agentId: scope === 'agent' ? agentId : null,
      version: newSkill.version,
    },
  })

  return NextResponse.json({ data: newSkill }, { status: 201 })
}
