/**
 * Path Policy - Centralized Workspace Path Validation
 *
 * Enforces security policies for workspace file operations:
 * - Rejects path traversal (..)
 * - Rejects invalid characters (backslash, null byte)
 * - Restricts to allowed subdirectories
 * - Resolves symlinks to prevent escape attacks
 */

import { realpathSync, existsSync, lstatSync } from 'fs'
import { resolve, normalize } from 'path'

// Workspace root defaults to ./workspace relative to cwd
// Can be overridden via WORKSPACE_ROOT env var
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || resolve(process.cwd(), 'workspace')

// Allowed top-level subdirectories within workspace
const ALLOWED_SUBDIRS = ['agents', 'overlays', 'skills', 'playbooks', 'plugins'] as const
type AllowedSubdir = (typeof ALLOWED_SUBDIRS)[number]

export interface PathValidationResult {
  valid: boolean
  error?: string
  resolvedPath?: string
}

/**
 * Validate a workspace path for security.
 * Returns validation result with resolved path if valid.
 *
 * @param inputPath - Path relative to workspace root (must start with /)
 * @returns Validation result
 */
export function validateWorkspacePath(inputPath: string): PathValidationResult {
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

  // Check subdirectory whitelist (if not root)
  if (normalized !== '') {
    const topDir = normalized.split('/')[0]
    if (!ALLOWED_SUBDIRS.includes(topDir as AllowedSubdir)) {
      return {
        valid: false,
        error: `Directory not allowed: ${topDir}. Allowed: ${ALLOWED_SUBDIRS.join(', ')}`,
      }
    }
  }

  // Construct full path
  const fullPath = resolve(WORKSPACE_ROOT, normalized)

  // Verify full path is still under workspace root (defense in depth)
  if (!fullPath.startsWith(WORKSPACE_ROOT)) {
    return { valid: false, error: 'Path escapes workspace root' }
  }

  // If path exists, resolve symlinks and verify
  if (existsSync(fullPath)) {
    try {
      const resolved = realpathSync(fullPath)
      if (!resolved.startsWith(WORKSPACE_ROOT)) {
        return { valid: false, error: 'Path escapes workspace via symlink' }
      }
      return { valid: true, resolvedPath: resolved }
    } catch (err) {
      return { valid: false, error: `Failed to resolve path: ${err}` }
    }
  }

  // For new files, check parent directory
  const parentPath = resolve(fullPath, '..')
  if (existsSync(parentPath)) {
    try {
      const resolvedParent = realpathSync(parentPath)
      if (!resolvedParent.startsWith(WORKSPACE_ROOT)) {
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
  return WORKSPACE_ROOT
}

/**
 * Get the list of allowed subdirectories
 */
export function getAllowedSubdirs(): readonly string[] {
  return ALLOWED_SUBDIRS
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

  // Must be in root or an allowed subdir
  if (normalized === '') return true // root
  const topDir = normalized.split('/')[0]
  return ALLOWED_SUBDIRS.includes(topDir as AllowedSubdir)
}
