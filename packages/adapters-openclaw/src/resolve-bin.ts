/**
 * CLI Binary Resolution
 *
 * Resolves the OpenClaw CLI binary name at runtime to support both:
 * - `openclaw` (new name)
 * - `clawdbot` (legacy name)
 *
 * Resolution order:
 * 1. OPENCLAW_BIN environment variable (explicit override)
 * 2. Try `openclaw --version`
 * 3. Try `clawdbot --version`
 * 4. Return null (graceful degradation)
 */

import { spawn } from 'child_process'

// ============================================================================
// TYPES
// ============================================================================

export type CliBinary = 'openclaw' | 'clawdbot'

export interface BinResolution {
  /** The resolved binary name, or null if not found */
  bin: CliBinary | null
  /** Version string from --version output */
  version: string | null
  /** How the binary was resolved */
  source: 'env' | 'auto' | 'fallback' | 'none'
  /** Error message if resolution failed */
  error?: string
}

// ============================================================================
// CACHE
// ============================================================================

let cached: BinResolution | null = null
let cacheTime = 0
const CACHE_TTL = 60_000 // 60 seconds

/**
 * Get the cached binary resolution, or null if not cached/expired
 */
export function getCachedBin(): BinResolution | null {
  if (cached && Date.now() - cacheTime < CACHE_TTL) {
    return cached
  }
  return null
}

/**
 * Clear the binary resolution cache
 */
export function clearBinCache(): void {
  cached = null
  cacheTime = 0
}

// ============================================================================
// RESOLUTION
// ============================================================================

/**
 * Try to run a binary with --version and return the version string
 */
async function tryBinary(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(bin, ['--version'], {
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
        // Extract version number from output
        const version = stdout.trim().match(/\d+\.\d+\.\d+/)?.[0] || stdout.trim().split('\n')[0]
        resolve(version || 'unknown')
      } else {
        resolve(null)
      }
    })
  })
}

/**
 * Resolve the CLI binary to use
 *
 * Resolution order:
 * 1. OPENCLAW_BIN env var (if set and valid)
 * 2. Try 'openclaw --version'
 * 3. Try 'clawdbot --version'
 * 4. Return null
 */
export async function resolveCliBin(): Promise<BinResolution> {
  // Check cache first
  const cachedResult = getCachedBin()
  if (cachedResult) {
    return cachedResult
  }

  let result: BinResolution

  // 1. Check OPENCLAW_BIN env var
  const envBin = process.env.OPENCLAW_BIN
  if (envBin) {
    if (envBin === 'openclaw' || envBin === 'clawdbot') {
      const version = await tryBinary(envBin)
      if (version) {
        result = { bin: envBin, version, source: 'env' }
      } else {
        result = { bin: null, version: null, source: 'none', error: `OPENCLAW_BIN=${envBin} not found` }
      }
    } else {
      // Custom binary path - try it
      const version = await tryBinary(envBin)
      if (version) {
        // Treat custom path as 'openclaw' for type purposes
        result = { bin: 'openclaw', version, source: 'env' }
      } else {
        result = { bin: null, version: null, source: 'none', error: `OPENCLAW_BIN=${envBin} not executable` }
      }
    }
  } else {
    // 2. Try 'openclaw' first (new name)
    const openclawVersion = await tryBinary('openclaw')
    if (openclawVersion) {
      result = { bin: 'openclaw', version: openclawVersion, source: 'auto' }
    } else {
      // 3. Try 'clawdbot' (legacy name)
      const clawdbotVersion = await tryBinary('clawdbot')
      if (clawdbotVersion) {
        result = { bin: 'clawdbot', version: clawdbotVersion, source: 'fallback' }
      } else {
        // 4. Neither found
        result = { bin: null, version: null, source: 'none', error: 'Neither openclaw nor clawdbot found in PATH' }
      }
    }
  }

  // Cache the result
  cached = result
  cacheTime = Date.now()

  return result
}

/**
 * Get the resolved binary name, throwing if not available
 */
export async function requireCliBin(): Promise<CliBinary> {
  const resolution = await resolveCliBin()
  if (!resolution.bin) {
    throw new Error(resolution.error || 'CLI binary not found')
  }
  return resolution.bin
}

/**
 * Check if CLI is available (non-throwing)
 */
export async function isCliAvailable(): Promise<boolean> {
  const resolution = await resolveCliBin()
  return resolution.bin !== null
}
