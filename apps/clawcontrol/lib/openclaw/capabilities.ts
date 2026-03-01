/**
 * OpenClaw Capabilities Probe
 *
 * Probes the OpenClaw CLI to detect which commands are supported.
 * This allows clawcontrol to gracefully degrade when running with
 * OpenClaw versions that don't support certain features (e.g., plugins).
 *
 * Probing is done using safe, non-mutating commands only (--help, list, info).
 * Results are cached in-memory with a configurable TTL (default: 60s).
 */

import { spawn } from 'child_process'
import { checkOpenClaw, getOpenClawBin } from '@clawcontrol/adapters-openclaw'

// ============================================================================
// TYPES
// ============================================================================

export interface PluginCapabilities {
  /** Whether the plugins subcommand exists at all */
  supported: boolean
  /** Whether `openclaw plugins list --json` works */
  listJson: boolean
  /** Whether `openclaw plugins info --json` works */
  infoJson: boolean
  /** Whether `openclaw plugins doctor` works */
  doctor: boolean
  /** Whether `openclaw plugins install` exists */
  install: boolean
  /** Whether `openclaw plugins enable` exists */
  enable: boolean
  /** Whether `openclaw plugins disable` exists */
  disable: boolean
  /** Whether `openclaw plugins uninstall` exists */
  uninstall: boolean
  /** Whether `openclaw plugins config` exists */
  setConfig: boolean
}

export interface AgentBindingsCapabilities {
  /** Whether the agents bindings subcommand exists */
  supported: boolean
  /** Whether `openclaw agents bind` works */
  bind: boolean
  /** Whether `openclaw agents unbind` works */
  unbind: boolean
}

export interface SecretsCapabilities {
  /** Whether the secrets subcommand exists */
  supported: boolean
  /** Whether `openclaw secrets list --json` works */
  listJson: boolean
}

export interface SourceCapabilities {
  /** Whether CLI is available on PATH */
  cli: boolean
  /** Whether HTTP API is configured (future) */
  http: boolean
}

export interface OpenClawCapabilities {
  /** OpenClaw version detected */
  version: string | null
  /** Whether OpenClaw is available */
  available: boolean
  /** Resolved binary path/name currently in use */
  resolvedBin: string
  /** Plugin-related capabilities */
  plugins: PluginCapabilities
  /** Agent bindings capabilities (OpenClaw v2026.2.26+) */
  agentBindings: AgentBindingsCapabilities
  /** Secrets management capabilities (OpenClaw v2026.2.26+) */
  secrets: SecretsCapabilities
  /** Data source capabilities */
  sources: SourceCapabilities
  /** When capabilities were last probed */
  probedAt: Date
  /** Any degradation message */
  degradedReason?: string
}

// ============================================================================
// CACHE
// ============================================================================

let cachedCapabilities: OpenClawCapabilities | null = null
let cacheTime = 0
const DEFAULT_CACHE_TTL = 60_000 // 60 seconds

/**
 * Configure the cache TTL (in milliseconds)
 */
let cacheTtl = DEFAULT_CACHE_TTL

export function setCapabilitiesCacheTtl(ttlMs: number): void {
  cacheTtl = ttlMs
}

/**
 * Clear the capabilities cache
 */
export function clearCapabilitiesCache(): void {
  cachedCapabilities = null
  cacheTime = 0
}

/**
 * Get cached capabilities if still valid
 */
function getCachedCapabilities(): OpenClawCapabilities | null {
  if (cachedCapabilities && Date.now() - cacheTime < cacheTtl) {
    return cachedCapabilities
  }
  return null
}

// ============================================================================
// PROBING HELPERS
// ============================================================================

/**
 * Run a command and return whether it succeeded (exit code 0)
 */
async function runCommand(args: string[], timeoutMs = 5000): Promise<{ success: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''

    const child = spawn(getOpenClawBin(), args, {
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    child.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    child.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    child.on('error', () => {
      resolve({ success: false, stdout, stderr })
    })

    child.on('close', (code) => {
      resolve({ success: code === 0, stdout, stderr })
    })
  })
}

/**
 * Check if a subcommand exists by running --help
 * The --help flag is safe and non-mutating
 */
async function probeSubcommand(subcommandArgs: string[]): Promise<boolean> {
  // Try running with --help to see if the command exists
  const result = await runCommand([...subcommandArgs, '--help'])

  // If --help works, the command exists
  if (result.success) return true

  // Some commands show help on stderr or exit with code 1 for --help
  // Check if the output mentions the subcommand (not "unknown command")
  const output = (result.stdout + result.stderr).toLowerCase()
  if (output.includes('unknown command') || output.includes('not found')) {
    return false
  }

  // If there's any help-like output, assume the command exists
  if (output.includes('usage:') || output.includes('options:') || output.includes('commands:')) {
    return true
  }

  return false
}

/**
 * Check if JSON output is supported for a command
 */
async function probeJsonSupport(subcommandArgs: string[]): Promise<boolean> {
  // Try --help and look for --json flag mention
  const helpResult = await runCommand([...subcommandArgs, '--help'])
  const helpOutput = (helpResult.stdout + helpResult.stderr).toLowerCase()

  if (helpOutput.includes('--json')) {
    return true
  }

  // Also try actually running the command with --json to see if it works
  const jsonResult = await runCommand([...subcommandArgs, '--json'])
  if (jsonResult.success) {
    // Check if output looks like JSON
    const output = jsonResult.stdout.trim()
    if (output.startsWith('{') || output.startsWith('[')) {
      return true
    }
  }

  return false
}

// ============================================================================
// MAIN PROBE FUNCTION
// ============================================================================

let hasLoggedCapabilities = false

/**
 * Probe OpenClaw to detect available capabilities
 *
 * This function uses only safe, non-mutating commands:
 * - `openclaw --version` - Get version
 * - `openclaw plugins --help` - Check if plugins subcommand exists
 * - `openclaw plugins list --help` - Check if list command exists
 * - `openclaw plugins list --json` - Check if JSON output works
 * - etc.
 *
 * Results are cached for 60 seconds by default.
 */
export async function getOpenClawCapabilities(): Promise<OpenClawCapabilities> {
  // Check cache first
  const cached = getCachedCapabilities()
  if (cached) {
    return cached
  }

  // Start with default capabilities (all false/unsupported)
  const capabilities: OpenClawCapabilities = {
    version: null,
    available: false,
    resolvedBin: getOpenClawBin(),
    plugins: {
      supported: false,
      listJson: false,
      infoJson: false,
      doctor: false,
      install: false,
      enable: false,
      disable: false,
      uninstall: false,
      setConfig: false,
    },
    agentBindings: { supported: false, bind: false, unbind: false },
    secrets: { supported: false, listJson: false },
    sources: {
      cli: false,
      http: false, // Future: detect HTTP API availability
    },
    probedAt: new Date(),
  }

  // Check if OpenClaw CLI is available
  const cliCheck = await checkOpenClaw()

  if (!cliCheck.available) {
    capabilities.resolvedBin = getOpenClawBin()
    capabilities.degradedReason = cliCheck.error || 'OpenClaw CLI not found'
    cacheCapabilities(capabilities)
    return capabilities
  }

  capabilities.available = true
  capabilities.version = cliCheck.version
  capabilities.resolvedBin = getOpenClawBin()
  capabilities.sources.cli = true

  if (cliCheck.belowMinVersion) {
    capabilities.degradedReason = `OpenClaw version ${cliCheck.version} is below minimum. Some features may not work.`
  }

  // Probe plugins subcommand
  const pluginsSupported = await probeSubcommand(['plugins'])
  capabilities.plugins.supported = pluginsSupported

  if (pluginsSupported) {
    // Probe individual plugin commands in parallel for speed
    const [listJson, infoJson, doctor, install, enable, disable, uninstall, setConfig] = await Promise.all([
      probeJsonSupport(['plugins', 'list']),
      probeJsonSupport(['plugins', 'info']),
      probeSubcommand(['plugins', 'doctor']),
      probeSubcommand(['plugins', 'install']),
      probeSubcommand(['plugins', 'enable']),
      probeSubcommand(['plugins', 'disable']),
      probeSubcommand(['plugins', 'uninstall']),
      probeSubcommand(['plugins', 'config']),
    ])

    capabilities.plugins.listJson = listJson
    capabilities.plugins.infoJson = infoJson
    capabilities.plugins.doctor = doctor
    capabilities.plugins.install = install
    capabilities.plugins.enable = enable
    capabilities.plugins.disable = disable
    capabilities.plugins.uninstall = uninstall
    capabilities.plugins.setConfig = setConfig

    // If plugins subcommand exists but no list, it's degraded
    if (!listJson) {
      capabilities.degradedReason = capabilities.degradedReason ||
        'Plugin list command not available. Plugin management is limited.'
    }
  } else {
    capabilities.degradedReason = capabilities.degradedReason ||
      'Plugin commands not supported by this OpenClaw version.'
  }

  // Probe agent bindings and secrets subcommands in parallel
  const [agentBindingsSupported, secretsSupported] = await Promise.all([
    probeSubcommand(['agents', 'bindings']),
    probeSubcommand(['secrets']),
  ])

  capabilities.agentBindings.supported = agentBindingsSupported
  if (agentBindingsSupported) {
    const [bind, unbind] = await Promise.all([
      probeSubcommand(['agents', 'bind']),
      probeSubcommand(['agents', 'unbind']),
    ])
    capabilities.agentBindings.bind = bind
    capabilities.agentBindings.unbind = unbind
  }

  capabilities.secrets.supported = secretsSupported
  if (secretsSupported) {
    capabilities.secrets.listJson = await probeJsonSupport(['secrets', 'list'])
  }

  // Cache and log
  cacheCapabilities(capabilities)

  // Log capabilities once per server boot
  if (!hasLoggedCapabilities) {
    console.log('[OpenClaw] Capabilities detected:', {
      version: capabilities.version,
      plugins: capabilities.plugins,
      agentBindings: capabilities.agentBindings,
      secrets: capabilities.secrets,
      sources: capabilities.sources,
      degradedReason: capabilities.degradedReason,
    })
    hasLoggedCapabilities = true
  }

  return capabilities
}

function cacheCapabilities(caps: OpenClawCapabilities): void {
  cachedCapabilities = caps
  cacheTime = Date.now()
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Check if a specific plugin capability is available
 */
export async function hasPluginCapability(
  capability: keyof PluginCapabilities
): Promise<boolean> {
  const caps = await getOpenClawCapabilities()
  return caps.plugins[capability]
}

/**
 * Check if agent bindings capability is available
 */
export async function hasAgentBindingsCapability(): Promise<boolean> {
  const caps = await getOpenClawCapabilities()
  return caps.agentBindings.supported
}

/**
 * Check if secrets management capability is available
 */
export async function hasSecretsCapability(): Promise<boolean> {
  const caps = await getOpenClawCapabilities()
  return caps.secrets.supported
}

/**
 * Check if any plugin functionality is available
 */
export async function isPluginManagementAvailable(): Promise<boolean> {
  const caps = await getOpenClawCapabilities()
  return caps.plugins.supported && caps.plugins.listJson
}

/**
 * Get a summary of unavailable capabilities for UI display
 */
export async function getUnavailablePluginActions(): Promise<string[]> {
  const caps = await getOpenClawCapabilities()
  const unavailable: string[] = []

  if (!caps.plugins.supported) {
    return ['All plugin management']
  }

  if (!caps.plugins.listJson) unavailable.push('List plugins')
  if (!caps.plugins.infoJson) unavailable.push('View plugin details')
  if (!caps.plugins.doctor) unavailable.push('Run diagnostics')
  if (!caps.plugins.install) unavailable.push('Install plugins')
  if (!caps.plugins.enable) unavailable.push('Enable plugins')
  if (!caps.plugins.disable) unavailable.push('Disable plugins')
  if (!caps.plugins.uninstall) unavailable.push('Uninstall plugins')
  if (!caps.plugins.setConfig) unavailable.push('Configure plugins')

  return unavailable
}
