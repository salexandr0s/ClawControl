/**
 * Skill Validator
 *
 * Server-side validation for skills. Runs on install, edit, and enable.
 * Validates folder name, required files, path safety, and size limits.
 */

import type {
  SkillValidationResult,
  SkillValidationError,
  SkillValidationStatus,
} from '@savorg/core'

// ============================================================================
// CONSTANTS
// ============================================================================

/** Max file size in bytes (256KB) */
const MAX_FILE_SIZE = 256 * 1024

/** Max total skill size in bytes (2MB) */
const MAX_SKILL_SIZE = 2 * 1024 * 1024

/** Skill name pattern: lowercase alphanumeric with hyphens/underscores */
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-_]{1,48}$/

/** Forbidden path patterns */
const FORBIDDEN_PATH_PATTERNS = [
  /\.\./,           // Parent directory traversal
  /^\/|^[a-zA-Z]:/, // Absolute paths
  /^~/,             // Home directory
]

// ============================================================================
// TYPES
// ============================================================================

export interface SkillFiles {
  skillMd?: string
  config?: string
  entrypoint?: string
  [key: string]: string | undefined
}

export interface ValidateSkillInput {
  name: string
  files: SkillFiles
  hasEntrypoint?: boolean
}

// ============================================================================
// VALIDATION RULES
// ============================================================================

function validateSkillName(name: string): SkillValidationError[] {
  const errors: SkillValidationError[] = []

  if (!name) {
    errors.push({
      code: 'NAME_REQUIRED',
      message: 'Skill name is required',
    })
    return errors
  }

  if (!SKILL_NAME_PATTERN.test(name)) {
    errors.push({
      code: 'NAME_INVALID',
      message: 'Skill name must be 2-50 characters, lowercase alphanumeric with hyphens/underscores, starting with a letter or number',
    })
  }

  // Check for reserved names
  const reserved = ['global', 'agent', 'system', 'core', 'internal']
  if (reserved.includes(name.toLowerCase())) {
    errors.push({
      code: 'NAME_RESERVED',
      message: `"${name}" is a reserved name and cannot be used`,
    })
  }

  return errors
}

function validateSkillMd(content: string | undefined): SkillValidationError[] {
  const errors: SkillValidationError[] = []

  if (!content) {
    errors.push({
      code: 'SKILL_MD_REQUIRED',
      message: 'skill.md is required',
      path: 'skill.md',
    })
    return errors
  }

  if (content.trim().length === 0) {
    errors.push({
      code: 'SKILL_MD_EMPTY',
      message: 'skill.md must not be empty',
      path: 'skill.md',
    })
  }

  // Check for minimum content (should have at least a heading)
  if (content.trim().length > 0 && !content.includes('#')) {
    errors.push({
      code: 'SKILL_MD_NO_HEADING',
      message: 'skill.md should have at least one heading (#)',
      path: 'skill.md',
    })
  }

  return errors
}

function validateConfig(content: string | undefined): SkillValidationError[] {
  const errors: SkillValidationError[] = []
  const _warnings: SkillValidationError[] = []

  if (!content) {
    return [] // Config is optional
  }

  try {
    JSON.parse(content)
  } catch (err) {
    errors.push({
      code: 'CONFIG_INVALID_JSON',
      message: `config.json is not valid JSON: ${err instanceof Error ? err.message : 'parse error'}`,
      path: 'config.json',
    })
  }

  return errors
}

function validatePathSafety(files: SkillFiles): SkillValidationError[] {
  const errors: SkillValidationError[] = []

  for (const [path, content] of Object.entries(files)) {
    if (!content) continue

    // Check path patterns
    for (const pattern of FORBIDDEN_PATH_PATTERNS) {
      if (pattern.test(path)) {
        errors.push({
          code: 'PATH_UNSAFE',
          message: `Unsafe path pattern detected: "${path}"`,
          path,
        })
        break
      }
    }

    // Check for null bytes
    if (path.includes('\0')) {
      errors.push({
        code: 'PATH_NULL_BYTE',
        message: `Null byte in path: "${path}"`,
        path,
      })
    }
  }

  return errors
}

function validateFileSizes(files: SkillFiles): SkillValidationError[] {
  const errors: SkillValidationError[] = []
  let totalSize = 0

  for (const [path, content] of Object.entries(files)) {
    if (!content) continue

    const size = new Blob([content]).size
    totalSize += size

    if (size > MAX_FILE_SIZE) {
      errors.push({
        code: 'FILE_TOO_LARGE',
        message: `File "${path}" exceeds max size of ${MAX_FILE_SIZE / 1024}KB (${Math.round(size / 1024)}KB)`,
        path,
      })
    }
  }

  if (totalSize > MAX_SKILL_SIZE) {
    errors.push({
      code: 'SKILL_TOO_LARGE',
      message: `Total skill size exceeds max of ${MAX_SKILL_SIZE / (1024 * 1024)}MB (${(totalSize / (1024 * 1024)).toFixed(2)}MB)`,
    })
  }

  return errors
}

function validateEntrypoint(
  files: SkillFiles,
  hasEntrypoint: boolean
): SkillValidationError[] {
  const warnings: SkillValidationError[] = []

  if (hasEntrypoint && !files.entrypoint) {
    warnings.push({
      code: 'ENTRYPOINT_MISSING',
      message: 'Skill claims to have an entrypoint but no entrypoint file was found',
      path: 'index.ts',
    })
  }

  return warnings
}

// ============================================================================
// MAIN VALIDATOR
// ============================================================================

/**
 * Validate a skill's structure and content.
 * Returns a validation result with errors, warnings, and status.
 */
export function validateSkill(input: ValidateSkillInput): SkillValidationResult {
  const errors: SkillValidationError[] = []
  const warnings: SkillValidationError[] = []

  // Run all validations
  errors.push(...validateSkillName(input.name))
  errors.push(...validateSkillMd(input.files.skillMd))
  errors.push(...validateConfig(input.files.config))
  errors.push(...validatePathSafety(input.files))
  errors.push(...validateFileSizes(input.files))

  // Warnings
  warnings.push(...validateEntrypoint(input.files, input.hasEntrypoint ?? false))

  // Add warning if skill.md has no heading (already in errors as soft check)
  const headingError = errors.findIndex((e) => e.code === 'SKILL_MD_NO_HEADING')
  if (headingError !== -1) {
    warnings.push(errors[headingError])
    errors.splice(headingError, 1)
  }

  // Determine status
  let status: SkillValidationStatus = 'valid'
  if (errors.length > 0) {
    status = 'invalid'
  } else if (warnings.length > 0) {
    status = 'warnings'
  }

  // Generate summary
  let summary = ''
  if (status === 'valid') {
    summary = 'Skill is valid and ready to use'
  } else if (status === 'warnings') {
    summary = `Skill is valid with ${warnings.length} warning${warnings.length > 1 ? 's' : ''}`
  } else {
    summary = `Skill has ${errors.length} error${errors.length > 1 ? 's' : ''}`
  }

  return {
    status,
    errors,
    warnings,
    summary,
    validatedAt: new Date(),
  }
}

/**
 * Check if a skill can be enabled based on its validation status.
 * Returns true if the skill is valid or only has warnings.
 */
export function canEnableSkill(validation: SkillValidationResult | undefined): boolean {
  if (!validation) return true // Unchecked skills can be enabled
  return validation.status !== 'invalid'
}

/**
 * Check if a skill requires override to enable (has errors).
 */
export function requiresEnableOverride(validation: SkillValidationResult | undefined): boolean {
  if (!validation) return false
  return validation.status === 'invalid'
}
