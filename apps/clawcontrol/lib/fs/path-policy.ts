/**
 * Path Policy - Centralized Workspace Path Validation
 *
 * Enforces security policies for workspace file operations:
 * - Rejects path traversal (..)
 * - Rejects invalid characters (backslash, null byte)
 * - Restricts to allowed subdirectories
 * - Resolves symlinks to prevent escape attacks
 */

import { readFileSync, realpathSync, existsSync, lstatSync, statSync } from 'fs'
import { homedir } from 'os'
import { resolve, join, relative, isAbsolute } from 'path'
import { load as loadYaml } from 'js-yaml'
import { readSettingsSync } from '@/lib/settings/store'

// Workspace root: where clawcontrol reads/writes agent files.
//
// Resolution order:
// - settings.json workspacePath
// - OPENCLAW_WORKSPACE (preferred)
// - CLAWCONTROL_WORKSPACE_ROOT (app-specific)
// - WORKSPACE_ROOT (legacy)
// - Historical config directories/files:
//   - ~/.openclaw/, ~/.moltbot/, ~/.clawdbot/
//   - Alias compatibility: ~/.OpenClaw/
//   - openclaw.json, moltbot.json, clawdbot.json, config.yaml
// - Historical workspace directories:
//   - ~/openclaw, ~/OpenClaw, ~/moltbot, ~/clawd
// - Final default:
//   - ~/openclaw (never infer workspace from process cwd)
const CONFIG_DIR_GROUPS = [
  ['.openclaw', '.OpenClaw'],
  ['.moltbot'],
  ['.clawdbot'],
] as const
const CONFIG_FILE_ORDER = ['openclaw.json', 'moltbot.json', 'clawdbot.json', 'config.yaml'] as const
const WORKSPACE_DIR_ORDER = ['openclaw', 'OpenClaw', 'moltbot', 'clawd'] as const
const WORKSPACE_ROOT_CACHE_TTL_MS = 5_000

function defaultWorkspaceRoot(): string {
  return resolve(homedir(), 'openclaw')
}

function pickWorkspaceRoot(): string {
  const settingsWorkspace = workspaceFromSettings()
  if (settingsWorkspace) return settingsWorkspace

  const envCandidates = [
    process.env.OPENCLAW_WORKSPACE,
    process.env.CLAWCONTROL_WORKSPACE_ROOT,
    process.env.WORKSPACE_ROOT,
  ]
    .filter((value): value is string => Boolean(value && value.trim()))
    .map((value) => resolve(value))

  for (const candidate of envCandidates) {
    return candidate
  }

  const configWorkspace = workspaceFromOpenClawConfigFiles()
  if (configWorkspace) return configWorkspace

  const knownWorkspace = workspaceFromKnownDirectories()
  if (knownWorkspace) return knownWorkspace

  return defaultWorkspaceRoot()
}

function workspaceFromSettings(): string | null {
  try {
    const { settings } = readSettingsSync()
    const configured = toNonEmptyString(settings.workspacePath)
    if (!configured) return null
    return resolve(configured)
  } catch {
    return null
  }
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function pathKey(inputPath: string): string {
  const normalized = resolve(inputPath)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function resolveWorkspaceInput(workspace: string, configDir: string): string {
  const trimmed = workspace.trim()
  const home = homedir()

  if (trimmed === '~') return resolve(home)
  if (trimmed.startsWith('~/')) return resolve(home, trimmed.slice(2))
  if (isAbsolute(trimmed)) return resolve(trimmed)
  return resolve(configDir, trimmed)
}

function workspaceFromParsedRecord(record: Record<string, unknown>, configDir: string): string | null {
  const agents = toRecord(record.agents)
  const defaults = toRecord(agents?.defaults)
  const workspace = toNonEmptyString(defaults?.workspace) ?? toNonEmptyString(record.workspace)
  if (!workspace) return null

  return resolveWorkspaceInput(workspace, configDir)
}

function workspaceFromOpenClawConfigFiles(): string | null {
  const home = homedir()
  const seenDirs = new Set<string>()
  const seenFiles = new Set<string>()

  for (const configDirGroup of CONFIG_DIR_GROUPS) {
    for (const configDirName of configDirGroup) {
      const configDir = join(home, configDirName)
      if (!existsSync(configDir)) continue
      try {
        if (!statSync(configDir).isDirectory()) continue
      } catch {
        continue
      }

      let realConfigDir = resolve(configDir)
      try {
        realConfigDir = realpathSync(configDir)
      } catch {
        // keep resolved candidate path
      }

      const dirKey = pathKey(realConfigDir)
      if (seenDirs.has(dirKey)) continue
      seenDirs.add(dirKey)

      for (const configFileName of CONFIG_FILE_ORDER) {
        const configPath = join(configDir, configFileName)
        if (!existsSync(configPath)) continue

        let realConfigPath = resolve(configPath)
        try {
          realConfigPath = realpathSync(configPath)
        } catch {
          // keep resolved candidate path
        }

        const fileKey = pathKey(realConfigPath)
        if (seenFiles.has(fileKey)) continue
        seenFiles.add(fileKey)

        try {
          const raw = readFileSync(configPath, 'utf8')
          const parsed = configFileName.endsWith('.yaml')
            ? toRecord(loadYaml(raw))
            : toRecord(JSON.parse(raw))

          if (!parsed) continue

          const workspace = workspaceFromParsedRecord(parsed, configDir)
          if (workspace) return workspace
        } catch {
          // Ignore malformed files and continue fallback chain.
        }
      }

    }
  }

  return null
}

function workspaceFromKnownDirectories(): string | null {
  const home = homedir()
  const seen = new Set<string>()

  for (const dirName of WORKSPACE_DIR_ORDER) {
    const candidate = join(home, dirName)
    if (!existsSync(candidate)) continue
    try {
      if (!statSync(candidate).isDirectory()) continue
    } catch {
      continue
    }

    let real = resolve(candidate)
    try {
      real = realpathSync(candidate)
    } catch {
      // keep resolved candidate path
    }

    const key = pathKey(real)
    if (seen.has(key)) continue
    seen.add(key)

    return real
  }

  return null
}

interface WorkspaceRootCacheEntry {
  root: string
  rootReal: string
  expiresAt: number
}

let workspaceRootCache: WorkspaceRootCacheEntry | null = null

function resolveWorkspaceRootEntry(): WorkspaceRootCacheEntry {
  const now = Date.now()
  if (workspaceRootCache && workspaceRootCache.expiresAt > now) {
    return workspaceRootCache
  }

  const root = pickWorkspaceRoot()
  let rootReal = root

  if (existsSync(root)) {
    try {
      rootReal = realpathSync(root)
    } catch {
      // Keep unresolved root when realpath cannot be resolved.
    }
  }

  workspaceRootCache = {
    root,
    rootReal,
    expiresAt: now + WORKSPACE_ROOT_CACHE_TTL_MS,
  }

  return workspaceRootCache
}

// Allowed top-level subdirectories within workspace
const ALLOWED_SUBDIRS = ['agents', 'overlays', 'skills', 'playbooks', 'plugins', 'agent-templates', 'workflows', 'workflow-packages', 'memory', 'life', 'docs', 'tools', 'templates', 'canvas', 'projects'] as const
type AllowedSubdir = (typeof ALLOWED_SUBDIRS)[number]

const ENFORCE_ROOT_ALLOWLIST = process.env.CLAWCONTROL_WORKSPACE_ALLOWLIST_ONLY === '1'

export function isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
  const root = resolve(rootPath)
  const candidate = resolve(candidatePath)
  const rel = relative(root, candidate)
  if (!rel) return true
  return !rel.startsWith('..') && !isAbsolute(rel)
}

// Allowed root-level files (e.g. /MEMORY.md). These do not live under a subdir.
const ALLOWED_ROOT_FILES = [
  'AGENTS.md',
  'MEMORY.md',
  'SOUL.md',
  'USER.md',
  'TOOLS.md',
  'HEARTBEAT.md',
  'README.md',
  'BOOTSTRAP.md',
  'COMMANDS.md',
  'IDENTITY.md',
  'SECURITY.md',
  'SECURITY.local.md',
  'WORKING.md',
] as const

export interface PathValidationResult {
  valid: boolean
  error?: string
  resolvedPath?: string
}

export function invalidateWorkspaceRootCache(): void {
  workspaceRootCache = null
}

/**
 * Validate a workspace path for security.
 * Returns validation result with resolved path if valid.
 *
 * @param inputPath - Path relative to workspace root (must start with /)
 * @returns Validation result
 */
export function validateWorkspacePath(inputPath: string): PathValidationResult {
  const workspaceRootEntry = resolveWorkspaceRootEntry()
  const workspaceRoot = workspaceRootEntry.root
  const workspaceRootReal = workspaceRootEntry.rootReal

  // Must start with /
  if (!inputPath.startsWith('/')) {
    return { valid: false, error: 'Path must start with /' }
  }

  // No path traversal
  if (inputPath.includes('..')) {
    return { valid: false, error: 'Path traversal (..) not allowed' }
  }

  // No Windows-style paths
  if (inputPath.includes('\\')) {
    return { valid: false, error: 'Backslash not allowed in path' }
  }

  // No null bytes
  if (inputPath.includes('\0')) {
    return { valid: false, error: 'Null byte not allowed in path' }
  }

  // Normalize path (remove double slashes, etc.)
  const normalized = inputPath.split('/').filter(Boolean).join('/')

  // Optional strict allowlist mode for high-restriction deployments.
  if (ENFORCE_ROOT_ALLOWLIST && normalized !== '') {
    const parts = normalized.split('/')
    const top = parts[0]

    const isRootFile = parts.length === 1 && (ALLOWED_ROOT_FILES as readonly string[]).includes(top)
    if (!isRootFile) {
      if (!ALLOWED_SUBDIRS.includes(top as AllowedSubdir)) {
        return {
          valid: false,
          error: `Directory not allowed: ${top}. Allowed: ${ALLOWED_SUBDIRS.join(', ')}`,
        }
      }
    }
  }

  // Construct full path
  const fullPath = resolve(workspaceRoot, normalized)

  // Verify full path is still under workspace root (defense in depth)
  if (!isPathWithinRoot(fullPath, workspaceRoot)) {
    return { valid: false, error: 'Path escapes workspace root' }
  }

  // If path exists, resolve symlinks and verify
  if (existsSync(fullPath)) {
    try {
      const resolved = realpathSync(fullPath)
      if (!isPathWithinRoot(resolved, workspaceRootReal)) {
        return { valid: false, error: 'Path escapes workspace via symlink' }
      }
      return { valid: true, resolvedPath: resolved }
    } catch (err) {
      return { valid: false, error: `Failed to resolve path: ${err}` }
    }
  }

  // For new files, check parent directory
  // Skip this check for WORKSPACE_ROOT itself - its parent is naturally outside
  const parentPath = resolve(fullPath, '..')
  if (fullPath !== workspaceRoot && existsSync(parentPath)) {
    try {
      const resolvedParent = realpathSync(parentPath)
      if (!isPathWithinRoot(resolvedParent, workspaceRootReal)) {
        return { valid: false, error: 'Parent path escapes workspace via symlink' }
      }
    } catch (err) {
      return { valid: false, error: `Failed to resolve parent path: ${err}` }
    }
  }

  return { valid: true, resolvedPath: fullPath }
}

/**
 * Check if a path is a symlink
 */
export function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * Get the workspace root path
 */
export function getWorkspaceRoot(): string {
  return resolveWorkspaceRootEntry().root
}

/**
 * Get the list of allowed subdirectories
 */
export function getAllowedSubdirs(): readonly string[] {
  return ALLOWED_SUBDIRS
}

export function getAllowedRootFiles(): readonly string[] {
  return ALLOWED_ROOT_FILES
}

export function isWorkspaceAllowlistOnly(): boolean {
  return ENFORCE_ROOT_ALLOWLIST
}

/**
 * Simple validation (legacy compatibility with workspace.ts)
 * Use validateWorkspacePath for full validation with symlink checking
 */
export function isValidWorkspacePath(path: string): boolean {
  // Must start with /
  if (!path.startsWith('/')) return false

  // No .. traversal
  if (path.includes('..')) return false

  // No backslashes (windows-style)
  if (path.includes('\\')) return false

  // No null bytes
  if (path.includes('\0')) return false

  // Normalize and check it's still under workspace
  const normalized = path.split('/').filter(Boolean).join('/')

  // Must be in root, an allowed root-level file, or an allowed subdir
  if (normalized === '') return true // root

  if (!ENFORCE_ROOT_ALLOWLIST) return true

  const parts = normalized.split('/')
  const top = parts[0]

  if (parts.length === 1 && (ALLOWED_ROOT_FILES as readonly string[]).includes(top)) {
    return true
  }

  return ALLOWED_SUBDIRS.includes(top as AllowedSubdir)
}
