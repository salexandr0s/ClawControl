import { NextRequest, NextResponse } from 'next/server'
import {
  mockGlobalSkills,
  mockAgentSkills,
  mockSkillContents,
} from '@savorgos/core'
import { validateSkill } from '@/lib/skill-validator'
import type { SkillScope } from '@savorgos/core'

function getSkillsArray(scope: SkillScope) {
  return scope === 'global' ? mockGlobalSkills : mockAgentSkills
}

/**
 * POST /api/skills/:scope/:id/validate
 * Validate a skill and store the result
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ scope: string; id: string }> }
) {
  const { scope, id } = await params

  if (!['global', 'agent'].includes(scope)) {
    return NextResponse.json({ error: 'Invalid scope' }, { status: 400 })
  }

  const skillsArray = getSkillsArray(scope as SkillScope)
  const skillIndex = skillsArray.findIndex((s) => s.id === id)

  if (skillIndex === -1) {
    return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
  }

  const skill = skillsArray[skillIndex]
  const content = mockSkillContents[id]

  // Run validation
  const validationResult = validateSkill({
    name: skill.name,
    files: {
      skillMd: content?.skillMd,
      config: content?.config,
    },
    hasEntrypoint: skill.hasEntrypoint,
  })

  // Update skill with validation result
  skillsArray[skillIndex] = {
    ...skill,
    validation: validationResult,
  }

  return NextResponse.json({
    data: {
      validation: validationResult,
    },
  })
}
