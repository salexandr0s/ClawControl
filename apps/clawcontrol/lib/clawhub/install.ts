import 'server-only'

import { promises as fsp } from 'node:fs'
import { dirname, posix } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import JSZip from 'jszip'
import { validateWorkspacePath } from '@/lib/fs/path-policy'

export class ClawHubInstallConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClawHubInstallConflictError'
  }
}

export function computeManifestHash(files: Array<{ path: string; sha256: string }>): string {
  const normalized = files
    .map((f) => ({ path: f.path, sha256: f.sha256 }))
    .sort((a, b) => a.path.localeCompare(b.path))

  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}

export interface ExtractZipResult {
  /** Workspace-relative directory path (e.g. /skills/foo) */
  destDir: string
  /** Workspace-relative file paths written under destDir */
  writtenPaths: string[]
}

export async function extractClawHubZipToWorkspaceDir(params: {
  zipBytes: Uint8Array
  destDir: string
  overwrite: boolean
}): Promise<ExtractZipResult> {
  const { destDir, overwrite } = params

  const destValidation = validateWorkspacePath(destDir)
  if (!destValidation.valid || !destValidation.resolvedPath) {
    throw new Error(destValidation.error || `Invalid destination path: ${destDir}`)
  }

  const zip = await JSZip.loadAsync(params.zipBytes)

  const zipFilePaths = Object.keys(zip.files)
    .filter((p) => !zip.files[p]?.dir)
    .filter((p) => !isIgnoredZipPath(p))

  const basePrefix = determineZipBasePrefix(zipFilePaths)

  const stageDir = `/tools/.clawhub-staging/${randomUUID()}`
  const stageValidation = validateWorkspacePath(stageDir)
  if (!stageValidation.valid || !stageValidation.resolvedPath) {
    throw new Error(stageValidation.error || `Invalid staging path: ${stageDir}`)
  }

  // Ensure stage parent exists.
  await fsp.mkdir(stageValidation.resolvedPath, { recursive: true })

  const writtenRels: string[] = []

  for (const originalPath of zipFilePaths) {
    const stripped = basePrefix && originalPath.startsWith(basePrefix)
      ? originalPath.slice(basePrefix.length)
      : originalPath

    const normalized = normalizeZipRelativePath(stripped)
    if (!normalized) continue

    const outRel = isRootSkillMd(normalized) ? 'skill.md' : normalized
    const outWorkspacePath = `${stageDir}/${outRel}`

    const outValidation = validateWorkspacePath(outWorkspacePath)
    if (!outValidation.valid || !outValidation.resolvedPath) {
      throw new Error(outValidation.error || `Invalid path in zip: ${outRel}`)
    }

    const zipEntry = zip.file(originalPath)
    if (!zipEntry) continue

    const content = await zipEntry.async('nodebuffer')

    await fsp.mkdir(dirname(outValidation.resolvedPath), { recursive: true })
    await fsp.writeFile(outValidation.resolvedPath, content)

    writtenRels.push(outRel)
  }

  if (!writtenRels.some((p) => p === 'skill.md')) {
    await safeRm(stageValidation.resolvedPath)
    throw new Error('Invalid skill bundle: SKILL.md (or skill.md) not found at bundle root')
  }

  const destAbs = destValidation.resolvedPath

  // Ensure destination parent exists.
  await fsp.mkdir(dirname(destAbs), { recursive: true })

  const exists = await pathExists(destAbs)
  if (exists && !overwrite) {
    await safeRm(stageValidation.resolvedPath)
    throw new ClawHubInstallConflictError(`Destination already exists: ${destDir}`)
  }

  if (exists && overwrite) {
    await safeRm(destAbs)
  }

  // Move stage into place.
  await fsp.rename(stageValidation.resolvedPath, destAbs)

  const writtenPaths = writtenRels
    .map((rel) => `${destDir}/${rel}`)
    .sort((a, b) => a.localeCompare(b))

  return { destDir, writtenPaths }
}

function isIgnoredZipPath(path: string): boolean {
  const normalized = path.replace(/\\\\/g, '/')
  if (normalized.startsWith('__MACOSX/')) return true
  if (normalized.endsWith('/.DS_Store') || normalized.endsWith('.DS_Store')) return true
  return false
}

function determineZipBasePrefix(filePaths: string[]): string {
  const rootHasSkillMd = filePaths.some((p) => isRootSkillMd(posix.basename(p)) && !p.includes('/'))
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

function isRootSkillMd(name: string): boolean {
  return name === 'SKILL.md' || name === 'skill.md'
}

function normalizeZipRelativePath(path: string): string | null {
  const fixed = path.replace(/\\\\/g, '/').trim()
  if (!fixed) return null
  if (fixed.startsWith('/')) return null

  const normalized = posix.normalize(fixed)
  if (normalized === '.' || normalized === '') return null
  if (normalized.startsWith('..')) return null
  if (posix.isAbsolute(normalized)) return null
  if (normalized.includes('\0')) return null
  return normalized
}

async function pathExists(absPath: string): Promise<boolean> {
  try {
    await fsp.access(absPath)
    return true
  } catch {
    return false
  }
}

async function safeRm(absPath: string): Promise<void> {
  try {
    await fsp.rm(absPath, { recursive: true, force: true })
  } catch {
    // ignore
  }
}
