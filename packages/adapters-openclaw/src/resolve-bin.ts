/**
 * OpenClaw CLI Binary Check
 *
 * Verifies that the `openclaw` CLI is available on PATH.
 * This project requires OpenClaw only (no legacy binary support).
 *
 * If openclaw is not found, OpenClaw-backed features are unavailable and
 * clawcontrol should render empty states (no mock/demo fixtures).
 */

import { spawn } from 'child_process'

// ============================================================================
// CONSTANTS
// ============================================================================

/** The only supported CLI binary */
export const OPENCLAW_BIN = 'openclaw'

/** Minimum supported OpenClaw version (semver) */
export const MIN_OPENCLAW_VERSION = '0.1.0'

// ============================================================================
// TYPES
// ============================================================================

export interface CliCheck {
  /** Whether openclaw is available on PATH */
  available: boolean
  /** Version string from --version output */
  version: string | null
  /** Error message if not available */
  error?: string
  /** Whether version is below minimum */
  belowMinVersion?: boolean
}

// ============================================================================
// CACHE
// ============================================================================

let cached: CliCheck | null = null
let cacheTime = 0
const CACHE_TTL = 60_000 // 60 seconds

/**
 * Get the cached CLI check result, or null if not cached/expired
 */
export function getCachedCheck(): CliCheck | null {
  if (cached && Date.now() - cacheTime < CACHE_TTL) {
    return cached
  }
  return null
}

/**
 * Clear the CLI check cache
 */
export function clearCache(): void {
  cached = null
  cacheTime = 0
}

// ============================================================================
// VERSION COMPARISON
// ============================================================================

/**
 * Extract the first semver-looking x.y.z from a string
 */
function extractSemver(version: string): string | null {
  const match = version.trim().match(/(\d+\.\d+\.\d+)/)
  return match ? match[1] : null
}

/**
 * Parse a semver string into [major, minor, patch]
 */
function parseSemver(version: string): [number, number, number] | null {
  const normalized = extractSemver(version)
  if (!normalized) return null
  const [major, minor, patch] = normalized.split('.')
  return [parseInt(major, 10), parseInt(minor, 10), parseInt(patch, 10)]
}

/**
 * Check if version A is less than version B
 */
function isVersionBelow(versionA: string, versionB: string): boolean {
  const a = parseSemver(versionA)
  const b = parseSemver(versionB)
  if (!a || !b) return false

  if (a[0] !== b[0]) return a[0] < b[0]
  if (a[1] !== b[1]) return a[1] < b[1]
  return a[2] < b[2]
}

// ============================================================================
// CLI CHECK
// ============================================================================

/**
 * Try to run openclaw --version and return the version string
 */
async function tryOpenClaw(): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(OPENCLAW_BIN, ['--version'], {
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''

    child.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    child.on('error', () => {
      resolve(null)
    })

    child.on('close', (code) => {
      if (code === 0) {
        const output = stdout.trim()
        resolve(output || null)
      } else {
        resolve(null)
      }
    })
  })
}

/**
 * Check if OpenClaw CLI is available
 *
 * Returns availability status, version, and any errors.
 * Result is cached for 60 seconds.
 */
export async function checkOpenClaw(): Promise<CliCheck> {
  // Check cache first
  const cachedResult = getCachedCheck()
  if (cachedResult) {
    return cachedResult
  }

  const versionOutput = await tryOpenClaw()

  let result: CliCheck

  if (versionOutput) {
    const normalizedVersion = extractSemver(versionOutput)
    const displayVersion = normalizedVersion ?? 'unknown'
    const belowMin = normalizedVersion
      ? isVersionBelow(normalizedVersion, MIN_OPENCLAW_VERSION)
      : false
    result = {
      available: true,
      version: displayVersion,
      belowMinVersion: belowMin,
      error: belowMin
        ? `OpenClaw version ${displayVersion} is below minimum ${MIN_OPENCLAW_VERSION}. Please upgrade.`
        : undefined,
    }
  } else {
    result = {
      available: false,
      version: null,
      error: `OpenClaw CLI not found. Install from https://github.com/openclaw/openclaw and ensure 'openclaw' is on PATH.`,
    }
  }

  // Cache the result
  cached = result
  cacheTime = Date.now()

  return result
}

/**
 * Check if CLI is available (non-throwing, simple boolean)
 */
export async function isCliAvailable(): Promise<boolean> {
  const check = await checkOpenClaw()
  return check.available
}

/**
 * Get OpenClaw version, throwing if not available
 */
export async function requireOpenClaw(): Promise<string> {
  const check = await checkOpenClaw()
  if (!check.available) {
    throw new Error(check.error || 'OpenClaw CLI not found')
  }
  return check.version || 'unknown'
}
