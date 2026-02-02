/**
 * Skills Repository
 *
 * Provides data access for skills with both mock and filesystem implementations.
 * Skills are stored in the OpenClaw workspace:
 *   - Global skills: ${WORKSPACE_ROOT}/skills/<skill-name>/
 *   - Agent-scoped: ${WORKSPACE_ROOT}/agents/<agent-id>/skills/<skill-name>/
 */

import { promises as fsp } from 'node:fs'
import { join, basename } from 'node:path'
import { mockGlobalSkills, mockAgentSkills, mockSkillContents, mockAgents } from '@savorg/core'
import {
  validateWorkspacePath,
  getWorkspaceRoot,
} from '../fs/path-policy'
import {
  encodeWorkspaceId,
  decodeWorkspaceId,
  listWorkspace,
} from '../fs/workspace-fs'
import type {
  SkillDTO,
  SkillScope,
  SkillValidationResult,
  SkillValidationError,
} from './types'

// ============================================================================
// TYPES
// ============================================================================

export interface SkillFilters {
  scope?: SkillScope
  agentId?: string
  enabled?: boolean
}

export interface CreateSkillInput {
  name: string
  description?: string
  scope: SkillScope
  agentId?: string
  skillMd: string
  config?: string
}

export interface UpdateSkillInput {
  enabled?: boolean
  skillMd?: string
  config?: string
}

export interface SkillWithContentDTO extends SkillDTO {
  skillMd: string
  config?: string
}

export interface DuplicateSkillTarget {
  scope: SkillScope
  agentId?: string
  newName?: string
}

// ============================================================================
// REPOSITORY INTERFACE
// ============================================================================

export interface SkillsRepo {
  list(filters?: SkillFilters): Promise<SkillDTO[]>
  getById(scope: SkillScope, id: string): Promise<SkillWithContentDTO | null>
  getByName(scope: SkillScope, name: string, agentId?: string): Promise<SkillWithContentDTO | null>
  create(input: CreateSkillInput): Promise<SkillDTO>
  update(scope: SkillScope, id: string, input: UpdateSkillInput): Promise<SkillDTO | null>
  delete(scope: SkillScope, id: string): Promise<boolean>
  validate(scope: SkillScope, id: string): Promise<SkillValidationResult>
  duplicate(scope: SkillScope, id: string, target: DuplicateSkillTarget): Promise<SkillDTO>
  exportZip(scope: SkillScope, id: string): Promise<Blob>
}

// ============================================================================
// MOCK IMPLEMENTATION
// ============================================================================

export function createMockSkillsRepo(): SkillsRepo {
  return {
    async list(filters?: SkillFilters): Promise<SkillDTO[]> {
      let skills = [...mockGlobalSkills, ...mockAgentSkills]

      if (filters?.scope === 'global') {
        skills = skills.filter((s) => s.scope === 'global')
      } else if (filters?.scope === 'agent') {
        skills = skills.filter((s) => s.scope === 'agent')
        if (filters?.agentId) {
          skills = skills.filter((s) => s.agentId === filters.agentId)
        }
      }

      if (filters?.enabled !== undefined) {
        skills = skills.filter((s) => s.enabled === filters.enabled)
      }

      // Add agent names for agent-scoped skills
      return skills.map((skill) => {
        if (skill.scope === 'agent' && skill.agentId) {
          const agent = mockAgents.find((a) => a.id === skill.agentId)
          return mockToDTO(skill, agent?.name)
        }
        return mockToDTO(skill)
      })
    },

    async getById(scope: SkillScope, id: string): Promise<SkillWithContentDTO | null> {
      const skills = scope === 'global' ? mockGlobalSkills : mockAgentSkills
      const skill = skills.find((s) => s.id === id)
      if (!skill) return null

      const content = mockSkillContents[id]
      const agent = skill.agentId ? mockAgents.find((a) => a.id === skill.agentId) : undefined

      return {
        ...mockToDTO(skill, agent?.name),
        skillMd: content?.skillMd ?? '',
        config: content?.config,
      }
    },

    async getByName(scope: SkillScope, name: string, agentId?: string): Promise<SkillWithContentDTO | null> {
      const skills = scope === 'global' ? mockGlobalSkills : mockAgentSkills
      const skill = skills.find((s) => {
        if (s.name !== name) return false
        if (scope === 'agent' && agentId && s.agentId !== agentId) return false
        return true
      })
      if (!skill) return null

      const content = mockSkillContents[skill.id]
      const agent = skill.agentId ? mockAgents.find((a) => a.id === skill.agentId) : undefined

      return {
        ...mockToDTO(skill, agent?.name),
        skillMd: content?.skillMd ?? '',
        config: content?.config,
      }
    },

    async create(input: CreateSkillInput): Promise<SkillDTO> {
      const now = new Date()
      const id = `skill_${input.scope === 'global' ? 'g' : 'a'}_${Date.now()}`

      const newSkill = {
        id,
        name: input.name,
        description: input.description ?? '',
        version: '1.0.0',
        scope: input.scope,
        agentId: input.agentId,
        enabled: true,
        usageCount: 0,
        lastUsedAt: null,
        installedAt: now,
        modifiedAt: now,
        hasConfig: !!input.config,
        hasEntrypoint: false,
        validation: undefined,
      }

      // Add to mock data
      if (input.scope === 'global') {
        mockGlobalSkills.push(newSkill as typeof mockGlobalSkills[number])
      } else {
        mockAgentSkills.push(newSkill as typeof mockAgentSkills[number])
      }

      // Store content
      mockSkillContents[id] = {
        skillMd: input.skillMd,
        config: input.config,
      }

      return mockToDTO(newSkill)
    },

    async update(scope: SkillScope, id: string, input: UpdateSkillInput): Promise<SkillDTO | null> {
      const skills = scope === 'global' ? mockGlobalSkills : mockAgentSkills
      const skillIndex = skills.findIndex((s) => s.id === id)
      if (skillIndex === -1) return null

      const skill = skills[skillIndex]

      // Update content if provided
      if (input.skillMd !== undefined || input.config !== undefined) {
        const existing = mockSkillContents[id] ?? { skillMd: '' }
        mockSkillContents[id] = {
          skillMd: input.skillMd ?? existing.skillMd,
          config: input.config ?? existing.config,
        }
      }

      // Update skill metadata
      const updated = {
        ...skill,
        enabled: input.enabled ?? skill.enabled,
        hasConfig: input.config !== undefined ? !!input.config : skill.hasConfig,
        modifiedAt: new Date(),
      }
      skills[skillIndex] = updated

      const agent = skill.agentId ? mockAgents.find((a) => a.id === skill.agentId) : undefined
      return mockToDTO(updated, agent?.name)
    },

    async delete(scope: SkillScope, id: string): Promise<boolean> {
      const skills = scope === 'global' ? mockGlobalSkills : mockAgentSkills
      const index = skills.findIndex((s) => s.id === id)
      if (index === -1) return false

      skills.splice(index, 1)
      delete mockSkillContents[id]
      return true
    },

    async validate(_scope: SkillScope, id: string): Promise<SkillValidationResult> {
      const content = mockSkillContents[id]
      const errors: SkillValidationError[] = []
      const warnings: SkillValidationError[] = []

      if (!content || !content.skillMd) {
        errors.push({
          code: 'SKILL_MD_MISSING',
          message: 'skill.md file is required',
          path: 'skill.md',
        })
      }

      if (content?.config) {
        try {
          JSON.parse(content.config)
        } catch {
          errors.push({
            code: 'CONFIG_INVALID_JSON',
            message: 'config.json is not valid JSON',
            path: 'config.json',
          })
        }
      }

      const status = errors.length > 0 ? 'invalid' : warnings.length > 0 ? 'warnings' : 'valid'

      return {
        status,
        errors,
        warnings,
        summary: errors.length > 0
          ? `Skill has ${errors.length} error(s)`
          : warnings.length > 0
            ? `Skill is valid with ${warnings.length} warning(s)`
            : 'Skill is valid and ready to use',
        validatedAt: new Date(),
      }
    },

    async duplicate(scope: SkillScope, id: string, target: DuplicateSkillTarget): Promise<SkillDTO> {
      const source = await this.getById(scope, id)
      if (!source) throw new Error('Source skill not found')

      return this.create({
        name: target.newName ?? `${source.name}-copy`,
        description: source.description,
        scope: target.scope,
        agentId: target.agentId,
        skillMd: source.skillMd,
        config: source.config,
      })
    },

    async exportZip(_scope: SkillScope, id: string): Promise<Blob> {
      const content = mockSkillContents[id]
      if (!content) throw new Error('Skill not found')

      // For mock, just return a placeholder - real impl would create actual zip
      const manifest = JSON.stringify({ id, exportedAt: new Date().toISOString() })
      return new Blob([manifest], { type: 'application/zip' })
    },
  }
}

// ============================================================================
// FILESYSTEM IMPLEMENTATION
// ============================================================================

export function createFsSkillsRepo(): SkillsRepo {
  return {
    async list(filters?: SkillFilters): Promise<SkillDTO[]> {
      const skills: SkillDTO[] = []
      const _workspaceRoot = getWorkspaceRoot() // Reserved for future use

      // Read global skills from /skills/
      if (!filters?.scope || filters.scope === 'global') {
        const globalSkills = await scanSkillsDirectory('/skills', 'global')
        skills.push(...globalSkills)
      }

      // Read agent skills from /agents/<agentId>/skills/
      if (!filters?.scope || filters.scope === 'agent') {
        try {
          const agentEntries = await listWorkspace('/agents')
          for (const entry of agentEntries.filter((e) => e.type === 'folder')) {
            if (filters?.agentId && entry.name !== filters.agentId) continue

            const agentSkillsPath = `/agents/${entry.name}/skills`
            const agentSkills = await scanSkillsDirectory(agentSkillsPath, 'agent', entry.name)
            skills.push(...agentSkills)
          }
        } catch {
          // agents directory might not exist
        }
      }

      // Apply enabled filter
      if (filters?.enabled !== undefined) {
        return skills.filter((s) => s.enabled === filters.enabled)
      }

      return skills
    },

    async getById(scope: SkillScope, id: string): Promise<SkillWithContentDTO | null> {
      const skillPath = decodeWorkspaceId(id.replace(/^skill_[ga]_/, ''))
      return parseSkillWithContent(skillPath, scope)
    },

    async getByName(scope: SkillScope, name: string, agentId?: string): Promise<SkillWithContentDTO | null> {
      const skillPath = scope === 'global'
        ? `/skills/${name}`
        : `/agents/${agentId}/skills/${name}`

      return parseSkillWithContent(skillPath, scope, agentId)
    },

    async create(input: CreateSkillInput): Promise<SkillDTO> {
      // Validate name
      if (!isValidSkillName(input.name)) {
        throw new Error('Invalid skill name. Use lowercase letters, numbers, and hyphens only.')
      }

      // Determine target path
      const skillPath = input.scope === 'global'
        ? `/skills/${input.name}`
        : `/agents/${input.agentId}/skills/${input.name}`

      // Validate path
      const pathResult = validateWorkspacePath(skillPath)
      if (!pathResult.valid) {
        throw new Error(pathResult.error || 'Invalid path')
      }

      const absPath = pathResult.resolvedPath!

      // Check if already exists
      try {
        await fsp.access(absPath)
        throw new Error('Skill with this name already exists')
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }

      // Create directory and files
      await fsp.mkdir(absPath, { recursive: true })
      await fsp.writeFile(join(absPath, 'skill.md'), input.skillMd, 'utf8')

      if (input.config) {
        await fsp.writeFile(join(absPath, 'config.json'), input.config, 'utf8')
      }

      // Return the created skill
      const skill = await parseSkillFromDirectory(skillPath, input.scope, input.agentId)
      if (!skill) throw new Error('Failed to create skill')
      return skill
    },

    async update(scope: SkillScope, id: string, input: UpdateSkillInput): Promise<SkillDTO | null> {
      const skillPath = decodeWorkspaceId(id.replace(/^skill_[ga]_/, ''))
      const pathResult = validateWorkspacePath(skillPath)
      if (!pathResult.valid || !pathResult.resolvedPath) return null

      const absPath = pathResult.resolvedPath

      // Check if exists
      try {
        await fsp.access(absPath)
      } catch {
        return null
      }

      // Update skill.md if provided
      if (input.skillMd !== undefined) {
        await fsp.writeFile(join(absPath, 'skill.md'), input.skillMd, 'utf8')
      }

      // Update config.json if provided
      if (input.config !== undefined) {
        if (input.config) {
          await fsp.writeFile(join(absPath, 'config.json'), input.config, 'utf8')
        } else {
          // Remove config if empty
          try {
            await fsp.unlink(join(absPath, 'config.json'))
          } catch {
            // Ignore if doesn't exist
          }
        }
      }

      // Note: enabled state is not stored on filesystem - would need metadata file
      // For now, all FS skills are considered enabled

      const agentId = scope === 'agent' ? skillPath.split('/')[2] : undefined
      return parseSkillFromDirectory(skillPath, scope, agentId)
    },

    async delete(scope: SkillScope, id: string): Promise<boolean> {
      const skillPath = decodeWorkspaceId(id.replace(/^skill_[ga]_/, ''))
      const pathResult = validateWorkspacePath(skillPath)
      if (!pathResult.valid || !pathResult.resolvedPath) return false

      try {
        await fsp.rm(pathResult.resolvedPath, { recursive: true })
        return true
      } catch {
        return false
      }
    },

    async validate(scope: SkillScope, id: string): Promise<SkillValidationResult> {
      const skill = await this.getById(scope, id)
      const errors: SkillValidationError[] = []
      const warnings: SkillValidationError[] = []

      if (!skill) {
        return {
          status: 'invalid',
          errors: [{ code: 'SKILL_NOT_FOUND', message: 'Skill not found' }],
          warnings: [],
          summary: 'Skill not found',
          validatedAt: new Date(),
        }
      }

      if (!skill.skillMd || skill.skillMd.trim() === '') {
        errors.push({
          code: 'SKILL_MD_EMPTY',
          message: 'skill.md is empty',
          path: 'skill.md',
        })
      }

      if (skill.config) {
        try {
          JSON.parse(skill.config)
        } catch {
          errors.push({
            code: 'CONFIG_INVALID_JSON',
            message: 'config.json is not valid JSON',
            path: 'config.json',
          })
        }
      }

      // Check for recommended sections in skill.md
      if (skill.skillMd && !skill.skillMd.includes('# ')) {
        warnings.push({
          code: 'NO_HEADING',
          message: 'skill.md should have at least one heading',
          path: 'skill.md',
        })
      }

      const status = errors.length > 0 ? 'invalid' : warnings.length > 0 ? 'warnings' : 'valid'

      return {
        status,
        errors,
        warnings,
        summary: errors.length > 0
          ? `Skill has ${errors.length} error(s)`
          : warnings.length > 0
            ? `Skill is valid with ${warnings.length} warning(s)`
            : 'Skill is valid and ready to use',
        validatedAt: new Date(),
      }
    },

    async duplicate(scope: SkillScope, id: string, target: DuplicateSkillTarget): Promise<SkillDTO> {
      const source = await this.getById(scope, id)
      if (!source) throw new Error('Source skill not found')

      return this.create({
        name: target.newName ?? `${source.name}-copy`,
        description: source.description,
        scope: target.scope,
        agentId: target.agentId,
        skillMd: source.skillMd,
        config: source.config,
      })
    },

    async exportZip(scope: SkillScope, id: string): Promise<Blob> {
      const skill = await this.getById(scope, id)
      if (!skill) throw new Error('Skill not found')

      // Create a simple manifest - real impl would use archiver or similar
      const manifest = {
        name: skill.name,
        version: skill.version,
        description: skill.description,
        scope: skill.scope,
        exportedAt: new Date().toISOString(),
        files: ['skill.md', ...(skill.config ? ['config.json'] : [])],
      }

      // For now, return JSON manifest - full impl would create actual zip
      return new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/zip' })
    },
  }
}

// ============================================================================
// HELPERS
// ============================================================================

async function scanSkillsDirectory(
  basePath: string,
  scope: SkillScope,
  agentId?: string
): Promise<SkillDTO[]> {
  const skills: SkillDTO[] = []

  try {
    const entries = await listWorkspace(basePath)

    for (const entry of entries.filter((e) => e.type === 'folder')) {
      const skillPath = `${basePath}/${entry.name}`
      const skill = await parseSkillFromDirectory(skillPath, scope, agentId)
      if (skill) skills.push(skill)
    }
  } catch {
    // Directory might not exist
  }

  return skills
}

async function parseSkillFromDirectory(
  skillPath: string,
  scope: SkillScope,
  agentId?: string
): Promise<SkillDTO | null> {
  const pathResult = validateWorkspacePath(skillPath)
  if (!pathResult.valid || !pathResult.resolvedPath) return null

  const absPath = pathResult.resolvedPath
  const skillMdPath = join(absPath, 'skill.md')

  try {
    // Check skill.md exists
    await fsp.access(skillMdPath)

    const skillMdContent = await fsp.readFile(skillMdPath, 'utf8')
    const stat = await fsp.stat(absPath)

    // Check for optional files
    const hasConfig = await fileExists(join(absPath, 'config.json'))
    const hasEntrypoint = await fileExists(join(absPath, 'index.ts'))

    // Parse metadata from skill.md
    const metadata = parseSkillMetadata(skillMdContent, basename(skillPath))

    const id = `skill_${scope === 'global' ? 'g' : 'a'}_${encodeWorkspaceId(skillPath)}`

    return {
      id,
      name: basename(skillPath),
      description: metadata.description ?? '',
      version: metadata.version ?? '1.0.0',
      scope,
      agentId,
      agentName: agentId, // Would need to lookup from agents repo for display name
      enabled: true, // FS skills are always enabled (no metadata file)
      usageCount: 0, // Would need tracking
      lastUsedAt: null,
      installedAt: stat.birthtime,
      modifiedAt: stat.mtime,
      hasConfig,
      hasEntrypoint,
    }
  } catch {
    return null
  }
}

async function parseSkillWithContent(
  skillPath: string,
  scope: SkillScope,
  agentId?: string
): Promise<SkillWithContentDTO | null> {
  const skill = await parseSkillFromDirectory(skillPath, scope, agentId)
  if (!skill) return null

  const pathResult = validateWorkspacePath(skillPath)
  if (!pathResult.valid || !pathResult.resolvedPath) return null

  const absPath = pathResult.resolvedPath

  try {
    const skillMd = await fsp.readFile(join(absPath, 'skill.md'), 'utf8')
    let config: string | undefined

    if (skill.hasConfig) {
      try {
        config = await fsp.readFile(join(absPath, 'config.json'), 'utf8')
      } catch {
        // Config file might have been deleted
      }
    }

    return { ...skill, skillMd, config }
  } catch {
    return null
  }
}

function parseSkillMetadata(skillMdContent: string, _fallbackName: string): {
  description?: string
  version?: string
} {
  // Try to extract description from first paragraph or heading
  const lines = skillMdContent.split('\n')
  let description: string | undefined

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // Skip headings for description
    if (trimmed.startsWith('#')) {
      // Could extract title from heading
      continue
    }

    // First non-empty, non-heading line is description
    description = trimmed.slice(0, 200) // Truncate
    break
  }

  // Try to extract version from frontmatter or content
  const versionMatch = skillMdContent.match(/version:\s*['"]?(\d+\.\d+\.\d+)['"]?/i)
  const version = versionMatch?.[1]

  return { description, version }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fsp.access(path)
    return true
  } catch {
    return false
  }
}

function isValidSkillName(name: string): boolean {
  // Must be lowercase alphanumeric with hyphens, 2-50 chars
  return /^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/.test(name) || /^[a-z0-9]{1,2}$/.test(name)
}

function mockToDTO(skill: typeof mockGlobalSkills[number] | typeof mockAgentSkills[number], agentName?: string): SkillDTO {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    version: skill.version,
    scope: skill.scope,
    agentId: 'agentId' in skill ? skill.agentId : undefined,
    agentName,
    enabled: skill.enabled,
    usageCount: skill.usageCount,
    lastUsedAt: skill.lastUsedAt,
    installedAt: skill.installedAt,
    modifiedAt: skill.modifiedAt,
    hasConfig: skill.hasConfig,
    hasEntrypoint: skill.hasEntrypoint,
    validation: skill.validation,
  }
}
