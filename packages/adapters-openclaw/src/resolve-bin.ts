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
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

// ============================================================================
// CONSTANTS
// ============================================================================

/** The only supported CLI binary */
const DEFAULT_OPENCLAW_BIN = 'openclaw'
let resolvedOpenClawBin = process.env.OPENCLAW_BIN?.trim() || DEFAULT_OPENCLAW_BIN
export const OPENCLAW_BIN = DEFAULT_OPENCLAW_BIN

/** Minimum supported OpenClaw version (date-based semver) */
export const MIN_OPENCLAW_VERSION = '2026.2.17'

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

function openClawBinaryCandidates(): string[] {
  const envBin = process.env.OPENCLAW_BIN?.trim()
  const candidates = [
    envBin,
    resolvedOpenClawBin,
    DEFAULT_OPENCLAW_BIN,
    '/opt/homebrew/bin/openclaw',
    '/usr/local/bin/openclaw',
    '/usr/bin/openclaw',
    join(homedir(), '.local', 'bin', 'openclaw'),
  ].filter((value): value is string => Boolean(value))

  const deduped: string[] = []
  for (const candidate of candidates) {
    if (!deduped.includes(candidate)) deduped.push(candidate)
  }

  return deduped
}

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
  resolvedOpenClawBin = process.env.OPENCLAW_BIN?.trim() || DEFAULT_OPENCLAW_BIN
}

export function getOpenClawBin(): string {
  return resolvedOpenClawBin
}

export function getOpenClawCheckTimestampMs(): number | null {
  return cacheTime > 0 ? cacheTime : null
}

export function getOpenClawCheckCacheTtlMs(): number {
  return CACHE_TTL
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
  const candidates = openClawBinaryCandidates()

  for (const candidate of candidates) {
    if (candidate.startsWith('/') && !existsSync(candidate)) continue

    const output = await new Promise<string | null>((resolve) => {
      const child = spawn(candidate, ['--version'], {
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
          const text = stdout.trim()
          resolve(text || null)
          return
        }
        resolve(null)
      })
    })

    if (output) {
      resolvedOpenClawBin = candidate
      return output
    }
  }

  return null
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
      error: `OpenClaw CLI not found. Install from https://github.com/openclaw/openclaw and ensure 'openclaw' is on PATH (or set OPENCLAW_BIN).`,
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
