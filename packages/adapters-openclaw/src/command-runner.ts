/**
 * OpenClaw Command Runner
 *
 * Executes OpenClaw CLI commands with:
 * - Command allowlist for security
 * - Streamed output for real-time receipt updates
 * - Exit code handling and duration tracking
 * - Graceful degradation when CLI is not available
 */

import { spawn, type ChildProcess } from 'child_process'
import type { CommandOutput } from './types'
import { checkOpenClaw, getOpenClawBin } from './resolve-bin'

// ============================================================================
// COMMAND ALLOWLIST
// ============================================================================

/**
 * Allowed OpenClaw commands.
 * Only commands in this list can be executed.
 *
 * Commands are stored as args arrays (binary is always 'openclaw').
 */
export const ALLOWED_COMMANDS = {
  // Health & Status
  'health': { args: ['health'], danger: false, description: 'Check gateway health' },
  'health.json': { args: ['health', '--json'], danger: false, description: 'Check gateway health (JSON output)' },
  'status': { args: ['gateway', 'status'], danger: false, description: 'Get gateway status' },
  'status.json': { args: ['gateway', 'status', '--json'], danger: false, description: 'Get gateway status (JSON output)' },
  'status.noprobe.json': {
    args: ['gateway', 'status', '--json', '--no-probe'],
    danger: false,
    description: 'Get gateway status (JSON output, no probe)',
  },
  'probe': { args: ['gateway', 'probe'], danger: false, description: 'Probe gateway connectivity' },

  // Doctor (note: openclaw doctor doesn't support --json flag)
  'doctor': { args: ['doctor'], danger: false, description: 'Run diagnostics' },
  'doctor.json': { args: ['doctor'], danger: false, description: 'Run diagnostics (text output, JSON not supported)' },
  'doctor.fix': { args: ['doctor', '--fix'], danger: true, description: 'Run diagnostics with auto-fix' },

  // Gateway Control
  'gateway.restart': { args: ['gateway', 'restart'], danger: true, description: 'Restart the gateway' },
  'gateway.stop': { args: ['gateway', 'stop'], danger: true, description: 'Stop the gateway' },
  'gateway.start': { args: ['gateway', 'start'], danger: false, description: 'Start the gateway' },

  // Logs
  'logs': { args: ['logs'], danger: false, description: 'View logs' },
  'logs.tail': { args: ['logs', '--follow'], danger: false, description: 'Tail logs' },

  // Cache & Sessions
  'cache.clear': { args: ['reset', '--scope', 'config', '--yes', '--non-interactive', '--dry-run'], danger: true, description: 'Clear cached config (dry-run preview)' },
  'sessions.reset': { args: ['reset', '--scope', 'config+creds+sessions', '--yes', '--non-interactive', '--dry-run'], danger: true, description: 'Reset sessions (dry-run preview)' },

  // Security Audit (documented at docs.openclaw.ai/gateway/security)
  'security.audit': { args: ['security', 'audit'], danger: false, description: 'Run security audit' },
  'security.audit.json': { args: ['security', 'audit', '--json'], danger: false, description: 'Run security audit (JSON output)' },
  'security.audit.deep': { args: ['security', 'audit', '--deep'], danger: false, description: 'Run deep security audit with live probe' },
  'security.audit.deep.json': { args: ['security', 'audit', '--deep', '--json'], danger: false, description: 'Run deep security audit (JSON output)' },
  'security.audit.fix': { args: ['security', 'audit', '--fix'], danger: true, description: 'Run security audit and apply safe guardrails' },
  'security.audit.fix.json': { args: ['security', 'audit', '--fix', '--json'], danger: true, description: 'Run security audit and apply fixes (JSON output)' },

  // Extended Status (documented at docs.openclaw.ai/gateway/troubleshooting)
  'status.all': { args: ['status', '--all'], danger: false, description: 'Comprehensive status report (redacts secrets)' },
  'status.all.json': { args: ['status', '--all', '--json'], danger: false, description: 'Comprehensive status report (JSON, redacts secrets)' },

  // Config reads (local-only)
  'config.agents.list.json': { args: ['config', 'get', 'agents.list', '--json'], danger: false, description: 'Read configured agents.list (JSON)' },
  'config.gateway.json': { args: ['config', 'get', 'gateway', '--json'], danger: false, description: 'Read gateway config (JSON)' },

  // Gateway Discovery (documented at docs.openclaw.ai/cli/gateway)
  'gateway.discover': { args: ['gateway', 'discover', '--json'], danger: false, description: 'Scan for gateways on network' },

  // Cron Management
  'cron.status.json': { args: ['cron', 'status', '--json'], danger: false, description: 'Get cron scheduler status (JSON output)' },
  'cron.jobs.json': { args: ['cron', 'list', '--json'], danger: false, description: 'List cron jobs (JSON output)' },
  // Note: cron.runs requires dynamic --id flag, handled separately in adapter

  // Plugin Management
  'plugins.list': { args: ['plugins', 'list'], danger: false, description: 'List installed plugins' },
  'plugins.list.json': { args: ['plugins', 'list', '--json'], danger: false, description: 'List installed plugins (JSON output)' },
  'plugins.info': { args: ['plugins', 'info'], danger: false, description: 'Get plugin info' },
  'plugins.doctor': { args: ['plugins', 'doctor'], danger: false, description: 'Run plugin diagnostics' },
  'plugins.install': { args: ['plugins', 'install'], danger: true, description: 'Install a plugin' },
  'plugins.uninstall': { args: ['plugins', 'uninstall'], danger: true, description: 'Uninstall a plugin' },
  'plugins.enable': { args: ['plugins', 'enable'], danger: true, description: 'Enable a plugin' },
  'plugins.disable': { args: ['plugins', 'disable'], danger: true, description: 'Disable a plugin' },
  'plugins.config': { args: ['plugins', 'config'], danger: true, description: 'Configure a plugin' },

  // Models Management
  'models.list.json': { args: ['models', 'list', '--json'], danger: false, description: 'List configured models (JSON output)' },
  'models.list.all.json': { args: ['models', 'list', '--all', '--json'], danger: false, description: 'List all available models (JSON output)' },
  'models.status.json': { args: ['models', 'status', '--json'], danger: false, description: 'Get model configuration status (JSON output)' },
  'models.status.probe.json': { args: ['models', 'status', '--probe', '--json'], danger: false, description: 'Get model status with live auth probe (JSON output)' },
} as const

export type AllowedCommandId = keyof typeof ALLOWED_COMMANDS

export interface CommandSpec {
  /** Command arguments (without binary name) */
  args: readonly string[]
  /** Whether this command is considered dangerous */
  danger: boolean
  /** Human-readable description */
  description: string
}

// ============================================================================
// COMMAND EXECUTION RESULT
// ============================================================================

export interface CommandExecutionResult {
  exitCode: number
  durationMs: number
  stdout: string
  stderr: string
  timedOut: boolean
  error?: string
}

export interface StreamingCommandOptions {
  /** Timeout in milliseconds (default: 60000) */
  timeout?: number
  /** Working directory */
  cwd?: string
  /** Environment variables */
  env?: Record<string, string>
  /** Callback for each output chunk (for receipt streaming) */
  onChunk?: (chunk: CommandOutput) => void | Promise<void>
}

function buildSpawnEnv(overrides?: Record<string, string>): NodeJS.ProcessEnv {
  // Prevent parent shell secrets from unexpectedly overriding local gateway auth.
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.OPENCLAW_GATEWAY_TOKEN
  delete env.CLAWDBOT_GATEWAY_TOKEN
  delete env.OPENCLAW_GATEWAY_PASSWORD
  delete env.CLAWDBOT_GATEWAY_PASSWORD
  return { ...env, ...(overrides ?? {}) }
}

// ============================================================================
// COMMAND RUNNER
// ============================================================================

/**
 * Check if a command is in the allowlist
 */
export function isAllowedCommand(commandId: string): commandId is AllowedCommandId {
  return commandId in ALLOWED_COMMANDS
}

/**
 * Get command spec from allowlist
 */
export function getCommandSpec(commandId: AllowedCommandId): CommandSpec {
  return ALLOWED_COMMANDS[commandId]
}

/**
 * Check if OpenClaw CLI is available
 */
export async function checkOpenClawAvailable(): Promise<{
  available: boolean
  version?: string
  error?: string
  belowMinVersion?: boolean
}> {
  const check = await checkOpenClaw()

  if (check.available) {
    return {
      available: true,
      version: check.version || undefined,
      belowMinVersion: check.belowMinVersion,
      error: check.error,
    }
  } else {
    return {
      available: false,
      error: check.error || 'OpenClaw CLI not found',
    }
  }
}

/**
 * Execute a command and stream output
 */
export async function* executeCommand(
  commandId: AllowedCommandId,
  options: StreamingCommandOptions = {}
): AsyncGenerator<CommandOutput, CommandExecutionResult, unknown> {
  // Check CLI availability first
  const cliCheck = await checkOpenClaw()

  if (!cliCheck.available) {
    const errorOutput: CommandOutput = {
      type: 'stderr',
      chunk: `OpenClaw CLI not available: ${cliCheck.error}\n`,
    }
    yield errorOutput
    await options.onChunk?.(errorOutput)

    const exitOutput: CommandOutput = { type: 'exit', code: 127 }
    yield exitOutput
    await options.onChunk?.(exitOutput)

    return {
      exitCode: 127,
      durationMs: 0,
      stdout: '',
      stderr: `OpenClaw CLI not available: ${cliCheck.error}\n`,
      timedOut: false,
      error: 'OpenClaw CLI not available',
    }
  }

  const spec = getCommandSpec(commandId)
  const args = spec.args as string[]
  const openClawBin = getOpenClawBin()
  const timeout = options.timeout ?? 60000

  const startTime = Date.now()
  let stdout = ''
  let stderr = ''
  let timedOut = false
  let child: ChildProcess | null = null

  try {
    child = spawn(openClawBin, args, {
      cwd: options.cwd,
      env: buildSpawnEnv(options.env),
      timeout,
    })

    // Handle stdout
    if (child.stdout) {
      for await (const chunk of child.stdout) {
        const text = chunk.toString()
        stdout += text
        const output: CommandOutput = { type: 'stdout', chunk: text }
        yield output
        await options.onChunk?.(output)
      }
    }

    // Handle stderr
    if (child.stderr) {
      for await (const chunk of child.stderr) {
        const text = chunk.toString()
        stderr += text
        const output: CommandOutput = { type: 'stderr', chunk: text }
        yield output
        await options.onChunk?.(output)
      }
    }

    // Wait for process to exit
    const exitCode = await new Promise<number>((resolve, reject) => {
      child!.on('close', (code) => {
        resolve(code ?? 1)
      })
      child!.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
          timedOut = true
          resolve(124) // Standard timeout exit code
        } else {
          reject(err)
        }
      })
    })

    const durationMs = Date.now() - startTime
    const exitOutput: CommandOutput = { type: 'exit', code: exitCode }
    yield exitOutput
    await options.onChunk?.(exitOutput)

    return {
      exitCode,
      durationMs,
      stdout,
      stderr,
      timedOut,
    }
  } catch (err) {
    const durationMs = Date.now() - startTime
    const error = err instanceof Error ? err.message : 'Unknown error'

    // Handle command not found
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      const errorOutput: CommandOutput = { type: 'stderr', chunk: `Command not found: ${openClawBin}\n` }
      yield errorOutput
      await options.onChunk?.(errorOutput)

      const exitOutput: CommandOutput = { type: 'exit', code: 127 }
      yield exitOutput
      await options.onChunk?.(exitOutput)

      return {
        exitCode: 127,
        durationMs,
        stdout,
        stderr: stderr + `Command not found: ${openClawBin}\n`,
        timedOut: false,
        error: 'Command not found',
      }
    }

    // Other errors
    const errorOutput: CommandOutput = { type: 'stderr', chunk: `Error: ${error}\n` }
    yield errorOutput
    await options.onChunk?.(errorOutput)

    const exitOutput: CommandOutput = { type: 'exit', code: 1 }
    yield exitOutput
    await options.onChunk?.(exitOutput)

    return {
      exitCode: 1,
      durationMs,
      stdout,
      stderr: stderr + `Error: ${error}\n`,
      timedOut,
      error,
    }
  }
}

/**
 * Execute a command and return the full result (non-streaming)
 */
export async function runCommand(
  commandId: AllowedCommandId,
  options: Omit<StreamingCommandOptions, 'onChunk'> = {}
): Promise<CommandExecutionResult> {
  const gen = executeCommand(commandId, options)
  let result: IteratorResult<CommandOutput, CommandExecutionResult>

  do {
    result = await gen.next()
  } while (!result.done)

  return result.value
}

function findMatchingJsonEnd(source: string, startIndex: number): number | null {
  const opening = source[startIndex]
  if (opening !== '{' && opening !== '[') return null

  const stack: string[] = [opening]
  let inString = false
  let escaped = false

  for (let i = startIndex + 1; i < source.length; i += 1) {
    const ch = source[i]

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === '{' || ch === '[') {
      stack.push(ch)
      continue
    }

    if (ch === '}' || ch === ']') {
      const last = stack.pop()
      if ((ch === '}' && last !== '{') || (ch === ']' && last !== '[')) {
        return null
      }
      if (stack.length === 0) return i
    }
  }

  return null
}

function isLikelyJsonArrayStart(source: string, index: number): boolean {
  if (source[index] !== '[') return false

  for (let i = index + 1; i < source.length; i += 1) {
    const ch = source[i]
    if (/\s/.test(ch)) continue
    return ch !== 'p' // Filters plugin log lines like "[plugins] ..."
      && ch !== 'P'
      && ch !== 'w' // Filters bracket-prefixed warning tags
      && ch !== 'W'
  }
  return false
}

/**
 * Parse JSON payload from command output that may include log prefixes.
 *
 * Some OpenClaw/plugin combinations emit non-JSON log lines before JSON output.
 * This helper extracts the first valid top-level JSON object/array payload.
 */
export function parseJsonFromCommandOutput<T = unknown>(stdout: string): T | null {
  const text = stdout.trim()
  if (!text) return null

  try {
    return JSON.parse(text) as T
  } catch {
    // Continue with extraction fallback.
  }

  const candidates: number[] = []
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '{') {
      candidates.push(i)
      continue
    }
    if (ch === '[' && isLikelyJsonArrayStart(text, i)) {
      candidates.push(i)
    }
  }

  for (const start of candidates) {
    const end = findMatchingJsonEnd(text, start)
    if (end === null) continue

    const candidate = text.slice(start, end + 1)
    try {
      return JSON.parse(candidate) as T
    } catch {
      // Try next candidate.
    }
  }

  return null
}

/**
 * Execute a command and return parsed JSON output
 */
export async function runCommandJson<T = unknown>(
  commandId: AllowedCommandId,
  options: Omit<StreamingCommandOptions, 'onChunk'> = {}
): Promise<{ data?: T; error?: string; exitCode: number }> {
  const result = await runCommand(commandId, options)

  if (result.exitCode !== 0) {
    return {
      error: result.stderr || result.error || `Command failed with exit code ${result.exitCode}`,
      exitCode: result.exitCode,
    }
  }

  const data = parseJsonFromCommandOutput<T>(result.stdout)
  if (data !== null) {
    return { data, exitCode: 0 }
  }
  return {
    error: 'Failed to parse JSON output',
    exitCode: result.exitCode,
  }
}

// ============================================================================
// DYNAMIC COMMAND EXECUTION (for commands with runtime parameters)
// ============================================================================

/**
 * Allowed dynamic commands that take runtime parameters.
 * Security: Only whitelisted command patterns are allowed.
 */
type DynamicCommandSpec = {
  baseArgs: readonly string[]
  requiredParams: readonly string[]
  optionalParams?: readonly string[]
  /** Parameters that are rendered as bare flags (`--flag`) when value is `true`. */
  booleanFlags?: readonly string[]
  /** Parameters rendered as positional args instead of `--key value`. */
  positionalParams?: readonly string[]
  danger: boolean
  description: string
  /**
   * Optional per-parameter validators. If omitted, a conservative default is used.
   * Note: validation is about preventing obviously-invalid args and log pollution, not shell injection;
   * we always spawn without a shell.
   */
  paramValidators?: Record<string, (value: string) => boolean>
  /** Whether this command accepts sensitive input via stdin (e.g. tokens). */
  acceptsStdin?: boolean
}

const defaultParamValidator = (value: string) => /^[a-zA-Z0-9_-]+$/.test(value)

const noNewlines = (maxLen: number) => (value: string) =>
  value.length > 0 &&
  value.length <= maxLen &&
  !value.includes('\0') &&
  !value.includes('\r') &&
  !value.includes('\n')

const cronNameValidator = noNewlines(128)

const cronIdValidator = (value: string) => /^[a-zA-Z0-9_-]{1,128}$/.test(value)

const pluginIdValidator = (value: string) => /^[a-zA-Z0-9._:-]{1,128}$/.test(value)

const cronDurationValidator = (value: string) => /^([1-9][0-9]*)(ms|s|m|h|d|w)$/.test(value)

const profileIdValidator = (value: string) => /^[a-zA-Z0-9_:-]{1,128}$/.test(value)

const expiresInValidator = (value: string) => /^[0-9]{1,6}[smhdwy]$/.test(value)

const modelReferenceValidator = (value: string) => /^[a-zA-Z0-9._:/-]{1,256}$/.test(value)

const aliasNameValidator = (value: string) => /^[a-zA-Z0-9._:-]{1,128}$/.test(value)

export const ALLOWED_DYNAMIC_COMMANDS = {
  'cron.runs': {
    baseArgs: ['cron', 'runs'],
    requiredParams: ['id'] as const,
    optionalParams: ['limit'] as const,
    danger: false,
    description: 'Get cron job run history (requires --id, optional --limit)',
    paramValidators: {
      id: cronIdValidator,
      limit: (v) => /^[1-9][0-9]{0,3}$/.test(v),
    },
  },
  'cron.run': {
    baseArgs: ['cron', 'run'],
    requiredParams: ['id'] as const,
    optionalParams: ['due'] as const,
    positionalParams: ['id'] as const,
    booleanFlags: ['due'] as const,
    danger: true,
    description: 'Trigger immediate execution of a cron job (requires <id>)',
    paramValidators: {
      id: cronIdValidator,
      due: (v) => v === 'true' || v === 'false',
    },
  },
  'cron.enable': {
    baseArgs: ['cron', 'enable'],
    requiredParams: ['id'] as const,
    positionalParams: ['id'] as const,
    danger: true,
    description: 'Enable a cron job (requires <id>)',
    paramValidators: {
      id: cronIdValidator,
    },
  },
  'cron.disable': {
    baseArgs: ['cron', 'disable'],
    requiredParams: ['id'] as const,
    positionalParams: ['id'] as const,
    danger: true,
    description: 'Disable a cron job (requires <id>)',
    paramValidators: {
      id: cronIdValidator,
    },
  },
  'cron.edit.every': {
    baseArgs: ['cron', 'edit'],
    requiredParams: ['id', 'every'] as const,
    positionalParams: ['id'] as const,
    danger: true,
    description: 'Edit cron frequency as interval duration (requires <id>, --every)',
    paramValidators: {
      id: cronIdValidator,
      every: cronDurationValidator,
    },
  },
  'cron.edit.cron': {
    baseArgs: ['cron', 'edit'],
    requiredParams: ['id', 'cron'] as const,
    optionalParams: ['tz', 'stagger', 'exact'] as const,
    positionalParams: ['id'] as const,
    booleanFlags: ['exact'] as const,
    danger: true,
    description: 'Edit cron frequency as cron expression (requires <id>, --cron)',
    paramValidators: {
      id: cronIdValidator,
      cron: noNewlines(256),
      tz: noNewlines(128),
      stagger: noNewlines(64),
      exact: (v) => v === 'true' || v === 'false',
    },
  },
  'cron.edit.at': {
    baseArgs: ['cron', 'edit'],
    requiredParams: ['id', 'at'] as const,
    positionalParams: ['id'] as const,
    danger: true,
    description: 'Edit cron frequency as one-shot time (requires <id>, --at)',
    paramValidators: {
      id: cronIdValidator,
      at: noNewlines(128),
    },
  },
  'cron.create': {
    baseArgs: ['cron', 'add', '--json'],
    requiredParams: ['name', 'session', 'wake'] as const,
    optionalParams: [
      'description',
      'disabled',
      'delete-after-run',
      'agent',
      'at',
      'every',
      'cron',
      'tz',
      'stagger',
      'exact',
      'system-event',
      'message',
      'model',
      'thinking',
      'timeout-seconds',
      'announce',
      'no-deliver',
      'channel',
      'to',
      'best-effort-deliver',
      'no-best-effort-deliver',
    ] as const,
    booleanFlags: [
      'disabled',
      'delete-after-run',
      'exact',
      'announce',
      'no-deliver',
      'best-effort-deliver',
      'no-best-effort-deliver',
    ] as const,
    danger: true,
    description: 'Create a cron job with OpenClaw 2.17+ flags',
    paramValidators: {
      name: cronNameValidator,
      description: noNewlines(512),
      disabled: (v) => v === 'true' || v === 'false',
      'delete-after-run': (v) => v === 'true' || v === 'false',
      agent: noNewlines(128),
      session: (v) => v === 'main' || v === 'isolated',
      wake: (v) => v === 'now' || v === 'next-heartbeat',
      at: noNewlines(128),
      every: cronDurationValidator,
      cron: noNewlines(256),
      tz: noNewlines(128),
      stagger: noNewlines(64),
      exact: (v) => v === 'true' || v === 'false',
      'system-event': noNewlines(8000),
      message: noNewlines(2000),
      model: noNewlines(256),
      thinking: (v) => ['off', 'minimal', 'low', 'medium', 'high'].includes(v),
      'timeout-seconds': (v) => /^[1-9][0-9]{0,4}$/.test(v),
      announce: (v) => v === 'true' || v === 'false',
      'no-deliver': (v) => v === 'true' || v === 'false',
      channel: noNewlines(128),
      to: noNewlines(256),
      'best-effort-deliver': (v) => v === 'true' || v === 'false',
      'no-best-effort-deliver': (v) => v === 'true' || v === 'false',
    },
  },
  'cron.delete': {
    baseArgs: ['cron', 'delete', '--json'],
    requiredParams: ['id'] as const,
    positionalParams: ['id'] as const,
    danger: true,
    description: 'Delete a cron job (requires <id>)',
    paramValidators: {
      id: cronIdValidator,
    },
  },
  'plugins.uninstall': {
    baseArgs: ['plugins', 'uninstall'],
    requiredParams: ['id'] as const,
    positionalParams: ['id'] as const,
    danger: true,
    description: 'Uninstall a plugin (requires <id>)',
    paramValidators: {
      id: pluginIdValidator,
    },
  },
  'plugins.enable': {
    baseArgs: ['plugins', 'enable'],
    requiredParams: ['id'] as const,
    positionalParams: ['id'] as const,
    danger: true,
    description: 'Enable a plugin (requires <id>)',
    paramValidators: {
      id: pluginIdValidator,
    },
  },
  'plugins.disable': {
    baseArgs: ['plugins', 'disable'],
    requiredParams: ['id'] as const,
    positionalParams: ['id'] as const,
    danger: true,
    description: 'Disable a plugin (requires <id>)',
    paramValidators: {
      id: pluginIdValidator,
    },
  },
  'plugins.install': {
    baseArgs: ['plugins', 'install'],
    requiredParams: ['spec'] as const,
    positionalParams: ['spec'] as const,
    danger: true,
    description: 'Install a plugin from local path/archive or npm spec',
    paramValidators: {
      spec: noNewlines(1024),
    },
  },
  'models.auth.paste-token': {
    baseArgs: ['models', 'auth', 'paste-token'],
    requiredParams: ['provider', 'profile-id'] as const,
    optionalParams: ['expires-in'] as const,
    danger: true,
    description: 'Paste a model auth token into auth-profiles.json (requires --provider, --profile-id)',
    acceptsStdin: true,
    paramValidators: {
      provider: defaultParamValidator,
      'profile-id': profileIdValidator,
      'expires-in': expiresInValidator,
    },
  },
  'models.fallbacks.remove': {
    baseArgs: ['models', 'fallbacks', 'remove'],
    requiredParams: ['model'] as const,
    positionalParams: ['model'] as const,
    danger: true,
    description: 'Remove a configured model fallback (requires model id or alias)',
    paramValidators: {
      model: modelReferenceValidator,
    },
  },
  'models.aliases.remove': {
    baseArgs: ['models', 'aliases', 'remove'],
    requiredParams: ['alias'] as const,
    positionalParams: ['alias'] as const,
    danger: true,
    description: 'Remove a configured model alias (requires alias name)',
    paramValidators: {
      alias: aliasNameValidator,
    },
  },
} as const satisfies Record<string, DynamicCommandSpec>

export type AllowedDynamicCommandId = keyof typeof ALLOWED_DYNAMIC_COMMANDS

function hasOnlyAllowedKeys(
  spec: DynamicCommandSpec,
  params: Record<string, string>
): { ok: true } | { ok: false; error: string } {
  const allowed = new Set<string>([
    ...spec.requiredParams,
    ...(spec.optionalParams ?? []),
  ])

  for (const key of Object.keys(params)) {
    if (!allowed.has(key)) {
      return { ok: false, error: `Unknown parameter: ${key}` }
    }
  }

  return { ok: true }
}

function validateParam(
  spec: DynamicCommandSpec,
  key: string,
  value: string
): { ok: true } | { ok: false; error: string } {
  const validator = spec.paramValidators?.[key] ?? defaultParamValidator
  if (!validator(value)) {
    return { ok: false, error: `Invalid parameter value for ${key}` }
  }
  return { ok: true }
}

/**
 * Execute a dynamic command with runtime parameters.
 * Security: Parameters are validated and only whitelisted commands are allowed.
 */
export async function runDynamicCommandJson<T = unknown>(
  commandId: AllowedDynamicCommandId,
  params: Record<string, string>,
  options: Omit<StreamingCommandOptions, 'onChunk'> = {}
): Promise<{ data?: T; error?: string; exitCode: number }> {
  const spec = ALLOWED_DYNAMIC_COMMANDS[commandId] as DynamicCommandSpec
  if (!spec) {
    return { error: `Unknown dynamic command: ${commandId}`, exitCode: 1 }
  }

  // Validate required params
  for (const param of spec.requiredParams) {
    if (!params[param]) {
      return { error: `Missing required parameter: ${param}`, exitCode: 1 }
    }
  }

  const allowedKeys = hasOnlyAllowedKeys(spec, params)
  if (!allowedKeys.ok) {
    return { error: allowedKeys.error, exitCode: 1 }
  }

  // Build args with parameters (stable order: required then optional)
  const args: string[] = [...spec.baseArgs]
  const boolFlags = new Set(spec.booleanFlags ?? [])
  const positionalParams = new Set(spec.positionalParams ?? [])
  for (const key of spec.requiredParams) {
    const value = params[key]
    const valid = validateParam(spec, key, value)
    if (!valid.ok) return { error: valid.error, exitCode: 1 }
    if (boolFlags.has(key)) {
      if (value === 'true') args.push(`--${key}`)
      continue
    }
    if (positionalParams.has(key)) {
      args.push(value)
      continue
    }
    args.push(`--${key}`, value)
  }
  for (const key of spec.optionalParams ?? []) {
    const value = params[key]
    if (value === undefined) continue
    const valid = validateParam(spec, key, value)
    if (!valid.ok) return { error: valid.error, exitCode: 1 }
    if (boolFlags.has(key)) {
      if (value === 'true') args.push(`--${key}`)
      continue
    }
    if (positionalParams.has(key)) {
      args.push(value)
      continue
    }
    args.push(`--${key}`, value)
  }

  // Check CLI availability
  const cliCheck = await checkOpenClaw()
  if (!cliCheck.available) {
    return {
      error: `OpenClaw CLI not available: ${cliCheck.error}`,
      exitCode: 127,
    }
  }

  const timeout = options.timeout ?? 60000
  const openClawBin = getOpenClawBin()
  const _startTime = Date.now() // Reserved for future latency tracking

  try {
    const child = spawn(openClawBin, args, {
      cwd: options.cwd,
      env: buildSpawnEnv(options.env),
      timeout,
    })

    let stdout = ''
    let stderr = ''

    if (child.stdout) {
      for await (const chunk of child.stdout) {
        stdout += chunk.toString()
      }
    }

    if (child.stderr) {
      for await (const chunk of child.stderr) {
        stderr += chunk.toString()
      }
    }

    const exitCode = await new Promise<number>((resolve) => {
      child.on('close', (code) => resolve(code ?? 1))
      child.on('error', () => resolve(1))
    })

    if (exitCode !== 0) {
      return {
        error: stderr || `Command failed with exit code ${exitCode}`,
        exitCode,
      }
    }

    const data = parseJsonFromCommandOutput<T>(stdout)
    if (data !== null) {
      return { data, exitCode: 0 }
    }
    return { error: 'Failed to parse JSON output', exitCode }
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'Unknown error',
      exitCode: 1,
    }
  }
}

/**
 * Execute a dynamic command and return raw stdout/stderr without JSON parsing.
 * Useful for commands that are non-JSON or accept sensitive stdin.
 */
export async function runDynamicCommand(
  commandId: AllowedDynamicCommandId,
  params: Record<string, string>,
  options: Omit<StreamingCommandOptions, 'onChunk'> & { stdin?: string } = {}
): Promise<CommandExecutionResult> {
  const spec = ALLOWED_DYNAMIC_COMMANDS[commandId] as DynamicCommandSpec

  if (!spec) {
    return {
      exitCode: 1,
      durationMs: 0,
      stdout: '',
      stderr: `Unknown dynamic command: ${commandId}\n`,
      timedOut: false,
      error: `Unknown dynamic command: ${commandId}`,
    }
  }

  // Validate required params
  for (const param of spec.requiredParams) {
    if (!params[param]) {
      return {
        exitCode: 1,
        durationMs: 0,
        stdout: '',
        stderr: `Missing required parameter: ${param}\n`,
        timedOut: false,
        error: `Missing required parameter: ${param}`,
      }
    }
  }

  const allowedKeys = hasOnlyAllowedKeys(spec, params)
  if (!allowedKeys.ok) {
    return {
      exitCode: 1,
      durationMs: 0,
      stdout: '',
      stderr: `${allowedKeys.error}\n`,
      timedOut: false,
      error: allowedKeys.error,
    }
  }

  if (options.stdin !== undefined && !spec.acceptsStdin) {
    return {
      exitCode: 1,
      durationMs: 0,
      stdout: '',
      stderr: 'stdin not allowed for this command\n',
      timedOut: false,
      error: 'stdin not allowed for this command',
    }
  }

  // Build args with parameters (stable order: required then optional)
  const args: string[] = [...spec.baseArgs]
  const boolFlags = new Set(spec.booleanFlags ?? [])
  const positionalParams = new Set(spec.positionalParams ?? [])
  for (const key of spec.requiredParams) {
    const value = params[key]
    const valid = validateParam(spec, key, value)
    if (!valid.ok) {
      return {
        exitCode: 1,
        durationMs: 0,
        stdout: '',
        stderr: `${valid.error}\n`,
        timedOut: false,
        error: valid.error,
      }
    }
    if (boolFlags.has(key)) {
      if (value === 'true') args.push(`--${key}`)
      continue
    }
    if (positionalParams.has(key)) {
      args.push(value)
      continue
    }
    args.push(`--${key}`, value)
  }
  for (const key of spec.optionalParams ?? []) {
    const value = params[key]
    if (value === undefined) continue
    const valid = validateParam(spec, key, value)
    if (!valid.ok) {
      return {
        exitCode: 1,
        durationMs: 0,
        stdout: '',
        stderr: `${valid.error}\n`,
        timedOut: false,
        error: valid.error,
      }
    }
    if (boolFlags.has(key)) {
      if (value === 'true') args.push(`--${key}`)
      continue
    }
    if (positionalParams.has(key)) {
      args.push(value)
      continue
    }
    args.push(`--${key}`, value)
  }

  // Check CLI availability
  const cliCheck = await checkOpenClaw()
  if (!cliCheck.available) {
    return {
      exitCode: 127,
      durationMs: 0,
      stdout: '',
      stderr: `OpenClaw CLI not available: ${cliCheck.error}\n`,
      timedOut: false,
      error: 'OpenClaw CLI not available',
    }
  }

  const timeout = options.timeout ?? 60000
  const start = Date.now()
  const openClawBin = getOpenClawBin()

  try {
    const child = spawn(openClawBin, args, {
      cwd: options.cwd,
      env: buildSpawnEnv(options.env),
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    if (options.stdin !== undefined && child.stdin) {
      child.stdin.write(options.stdin)
      if (!options.stdin.endsWith('\n')) child.stdin.write('\n')
      child.stdin.end()
    } else if (child.stdin) {
      child.stdin.end()
    }

    let stdout = ''
    let stderr = ''

    if (child.stdout) {
      for await (const chunk of child.stdout) stdout += chunk.toString()
    }
    if (child.stderr) {
      for await (const chunk of child.stderr) stderr += chunk.toString()
    }

    const exitCode = await new Promise<number>((resolve) => {
      child.on('close', (code) => resolve(code ?? 1))
      child.on('error', () => resolve(1))
    })

    return {
      exitCode,
      durationMs: Date.now() - start,
      stdout,
      stderr,
      timedOut: false,
      error: exitCode === 0 ? undefined : (stderr || `Command failed with exit code ${exitCode}`),
    }
  } catch (err) {
    return {
      exitCode: 1,
      durationMs: Date.now() - start,
      stdout: '',
      stderr: err instanceof Error ? `${err.message}\n` : 'Unknown error\n',
      timedOut: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}
