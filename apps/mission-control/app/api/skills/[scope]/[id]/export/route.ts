import { NextRequest, NextResponse } from 'next/server'
import {
  mockGlobalSkills,
  mockAgentSkills,
  mockSkillContents,
} from '@savorg/core'
import type { SkillScope, SkillManifest } from '@savorg/core'
import JSZip from 'jszip'

/**
 * GET /api/skills/:scope/:id/export
 * Export a skill as a zip file with manifest
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ scope: string; id: string }> }
) {
  const { scope, id } = await params

  if (!['global', 'agent'].includes(scope)) {
    return NextResponse.json({ error: 'Invalid scope' }, { status: 400 })
  }

  const skills = scope === 'global' ? mockGlobalSkills : mockAgentSkills
  const skill = skills.find((s) => s.id === id)

  if (!skill) {
    return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
  }

  // Get skill content
  const content = mockSkillContents[id]

  // Create zip file
  const zip = new JSZip()

  // Add skill.md
  const skillMd = content?.skillMd ?? `# ${skill.name}\n\n${skill.description}\n`
  zip.file('skill.md', skillMd)

  // Add config.json if exists
  if (content?.config) {
    zip.file('config.json', content.config)
  }

  // Build file list
  const files: string[] = ['skill.md']
  if (content?.config) {
    files.push('config.json')
  }

  // Create manifest
  const manifest: SkillManifest = {
    name: skill.name,
    version: skill.version,
    scope: skill.scope as SkillScope,
    agentId: skill.agentId,
    description: skill.description,
    exportedAt: new Date(),
    files,
  }

  zip.file('savorg-skill.json', JSON.stringify(manifest, null, 2))

  // Generate zip as blob (compatible with NextResponse)
  const zipBlob = await zip.generateAsync({ type: 'blob' })

  // Return zip file
  return new NextResponse(zipBlob, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${skill.name}-${skill.version}.zip"`,
    },
  })
}
