/**
 * Skills Repository
 *
 * Provides data access for skills via the filesystem.
 * Skills are stored in the OpenClaw workspace:
 *   - Global skills: ${WORKSPACE_ROOT}/skills/<skill-name>/
 *   - Agent-scoped: ${WORKSPACE_ROOT}/agents/<agent-id>/skills/<skill-name>/
 */

import { promises as fsp } from 'node:fs'
import { join, basename, dirname, posix } from 'node:path'
import JSZip from 'jszip'
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
  importZip(file: File, options: { scope: SkillScope; agentId?: string }): Promise<SkillDTO>
  exportZip(scope: SkillScope, id: string): Promise<Blob>
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

    async importZip(
      file: File,
      options: { scope: SkillScope; agentId?: string }
    ): Promise<SkillDTO> {
      if (options.scope === 'agent' && !options.agentId) {
        throw new Error('Agent ID is required for agent-scoped skills')
      }

      const buffer = await file.arrayBuffer()
      const zip = await JSZip.loadAsync(buffer)

      const zipFilePaths = Object.keys(zip.files)
        .filter((p) => !zip.files[p]?.dir)
        .filter((p) => !isIgnoredZipPath(p))

      const basePrefix = determineZipBasePrefix(zipFilePaths)
      const skillMdZipPath = findSkillMdZipPath(zipFilePaths, basePrefix)
      if (!skillMdZipPath) {
        throw new Error('Invalid skill: SKILL.md (or skill.md) not found')
      }

      const skillMd = await zip.file(skillMdZipPath)!.async('string')

      const folderNameFallback = basePrefix
        ? basePrefix.replace(/\/$/, '')
        : file.name.replace(/\.zip$/i, '')

      const derivedName = deriveSkillNameFromMd(skillMd) ?? folderNameFallback
      const skillName = slugifySkillName(derivedName)

      if (!isValidSkillName(skillName)) {
        throw new Error('Invalid skill name derived from ZIP')
      }

      const existing = await this.getByName(options.scope, skillName, options.agentId)
      if (existing) {
        throw new Error(`Skill "${skillName}" already exists`)
      }

      const skillPath = options.scope === 'global'
        ? `/skills/${skillName}`
        : `/agents/${options.agentId}/skills/${skillName}`

      const dirResult = validateWorkspacePath(skillPath)
      if (!dirResult.valid || !dirResult.resolvedPath) {
        throw new Error(dirResult.error || 'Invalid path')
      }

      await fsp.mkdir(dirResult.resolvedPath, { recursive: true })

      for (const originalPath of zipFilePaths) {
        const stripped = basePrefix && originalPath.startsWith(basePrefix)
          ? originalPath.slice(basePrefix.length)
          : originalPath

        const normalized = normalizeZipRelativePath(stripped)
        if (!normalized) continue

        const outRel = isSkillMdFilename(normalized) ? 'skill.md' : normalized
        const outWorkspacePath = `${skillPath}/${outRel}`

        const fileResult = validateWorkspacePath(outWorkspacePath)
        if (!fileResult.valid || !fileResult.resolvedPath) {
          throw new Error(fileResult.error || `Invalid path: ${outRel}`)
        }

        const zipEntry = zip.file(originalPath)
        if (!zipEntry) continue
        const content = await zipEntry.async('nodebuffer')

        await fsp.mkdir(dirname(fileResult.resolvedPath), { recursive: true })
        await fsp.writeFile(fileResult.resolvedPath, content)
      }

      const created = await parseSkillFromDirectory(skillPath, options.scope, options.agentId)
      if (!created) throw new Error('Failed to import skill')
      return created
    },

    async exportZip(scope: SkillScope, id: string): Promise<Blob> {
      const skill = await this.getById(scope, id)
      if (!skill) throw new Error('Skill not found')

      const skillPath = decodeWorkspaceId(id.replace(/^skill_[ga]_/, ''))
      const pathResult = validateWorkspacePath(skillPath)
      if (!pathResult.valid || !pathResult.resolvedPath) {
        throw new Error(pathResult.error || 'Invalid path')
      }

      const absSkillDir = pathResult.resolvedPath

      const zip = new JSZip()

      const files = await walkDirFiles(absSkillDir)
      const exportedFileNames: string[] = []

      for (const f of files) {
        if (isIgnoredExportPath(f.relPosixPath)) continue

        const data = await fsp.readFile(f.absPath)
        if (f.relPosixPath === 'skill.md') {
          zip.file('SKILL.md', data)
          exportedFileNames.push('SKILL.md')
          continue
        }

        zip.file(f.relPosixPath, data)
        exportedFileNames.push(f.relPosixPath)
      }

      // Small manifest for provenance/debugging
      zip.file(
        'manifest.json',
        JSON.stringify(
          {
            name: skill.name,
            version: skill.version,
            description: skill.description,
            scope: skill.scope,
            agentId: skill.agentId ?? null,
            exportedAt: new Date().toISOString(),
            files: exportedFileNames.sort(),
          },
          null,
          2
        )
      )

      const zipBytes = await zip.generateAsync({
        type: 'uint8array',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      })

      const zipArrayBuffer = new ArrayBuffer(zipBytes.byteLength)
      new Uint8Array(zipArrayBuffer).set(zipBytes)
      return new Blob([zipArrayBuffer], { type: 'application/zip' })
    },
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function isIgnoredZipPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/')
  if (normalized.startsWith('__MACOSX/')) return true
  if (normalized.endsWith('/.DS_Store') || normalized.endsWith('.DS_Store')) return true
  return false
}

function determineZipBasePrefix(filePaths: string[]): string {
  const rootHasSkillMd = filePaths.some((p) => isSkillMdFilename(posix.basename(p)) && !p.includes('/'))
  if (rootHasSkillMd) return ''

  const firstSegments = new Set(
    filePaths
      .map((p) => p.split('/')[0])
      .filter(Boolean)
  )

  if (firstSegments.size !== 1) return ''
  const [segment] = [...firstSegments]

  const segmentHasSkillMd = filePaths.some((p) => p === `${segment}/SKILL.md` || p === `${segment}/skill.md`)
  return segmentHasSkillMd ? `${segment}/` : ''
}

function findSkillMdZipPath(filePaths: string[], basePrefix: string): string | null {
  const candidates = new Set<string>()
  for (const p of filePaths) {
    if (basePrefix && !p.startsWith(basePrefix)) continue
    const stripped = basePrefix ? p.slice(basePrefix.length) : p
    if (!stripped || stripped.includes('/')) continue
    if (isSkillMdFilename(stripped)) candidates.add(p)
  }

  if (candidates.size === 0) return null
  if (candidates.has(basePrefix ? `${basePrefix}SKILL.md` : 'SKILL.md')) {
    return basePrefix ? `${basePrefix}SKILL.md` : 'SKILL.md'
  }
  return [...candidates][0] ?? null
}

function isSkillMdFilename(name: string): boolean {
  return name === 'SKILL.md' || name === 'skill.md'
}

function normalizeZipRelativePath(path: string): string | null {
  const fixed = path.replace(/\\/g, '/').trim()
  if (!fixed) return null
  if (fixed.startsWith('/')) return null

  const normalized = posix.normalize(fixed)
  if (normalized === '.' || normalized === '') return null
  if (normalized.startsWith('..')) return null
  if (posix.isAbsolute(normalized)) return null
  if (normalized.includes('\0')) return null
  return normalized
}

function deriveSkillNameFromMd(skillMd: string): string | null {
  const match = skillMd.match(/^#\s+(.+)$/m)
  return match?.[1]?.trim() || null
}

function slugifySkillName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function isIgnoredExportPath(relPosixPath: string): boolean {
  const parts = relPosixPath.split('/')
  if (parts.includes('node_modules')) return true
  if (parts.includes('.git')) return true
  if (relPosixPath.endsWith('.DS_Store')) return true
  return false
}

async function walkDirFiles(absDir: string): Promise<Array<{ absPath: string; relPosixPath: string }>> {
  const results: Array<{ absPath: string; relPosixPath: string }> = []

  async function walk(currentAbs: string, prefix: string) {
    const entries = await fsp.readdir(currentAbs, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue
        await walk(join(currentAbs, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name)
        continue
      }
      if (!entry.isFile()) continue
      const relPosixPath = prefix ? `${prefix}/${entry.name}` : entry.name
      results.push({ absPath: join(currentAbs, entry.name), relPosixPath })
    }
  }

  await walk(absDir, '')
  return results
}

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
