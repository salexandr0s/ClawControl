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
import { checkOpenClaw, OPENCLAW_BIN } from './resolve-bin'

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
  'probe': { args: ['gateway', 'probe'], danger: false, description: 'Probe gateway connectivity' },

  // Doctor
  'doctor': { args: ['doctor'], danger: false, description: 'Run diagnostics' },
  'doctor.json': { args: ['doctor', '--json'], danger: false, description: 'Run diagnostics (JSON output)' },
  'doctor.fix': { args: ['doctor', '--fix'], danger: true, description: 'Run diagnostics with auto-fix' },

  // Gateway Control
  'gateway.restart': { args: ['gateway', 'restart'], danger: true, description: 'Restart the gateway' },
  'gateway.stop': { args: ['gateway', 'stop'], danger: true, description: 'Stop the gateway' },
  'gateway.start': { args: ['gateway', 'start'], danger: false, description: 'Start the gateway' },

  // Logs
  'logs': { args: ['logs'], danger: false, description: 'View logs' },
  'logs.tail': { args: ['logs', '--follow'], danger: false, description: 'Tail logs' },

  // Security Audit (documented at docs.openclaw.ai/gateway/security)
  'security.audit': { args: ['security', 'audit'], danger: false, description: 'Run security audit' },
  'security.audit.deep': { args: ['security', 'audit', '--deep'], danger: false, description: 'Run deep security audit with live probe' },
  'security.audit.fix': { args: ['security', 'audit', '--fix'], danger: true, description: 'Run security audit and apply safe guardrails' },

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
  'plugins.info.json': { args: ['plugins', 'info', '--json'], danger: false, description: 'Get plugin info (JSON output)' },
  'plugins.doctor': { args: ['plugins', 'doctor'], danger: false, description: 'Run plugin diagnostics' },
  'plugins.doctor.json': { args: ['plugins', 'doctor', '--json'], danger: false, description: 'Run plugin diagnostics (JSON output)' },
  'plugins.install': { args: ['plugins', 'install'], danger: true, description: 'Install a plugin' },
  'plugins.uninstall': { args: ['plugins', 'uninstall'], danger: true, description: 'Uninstall a plugin' },
  'plugins.enable': { args: ['plugins', 'enable'], danger: true, description: 'Enable a plugin' },
  'plugins.disable': { args: ['plugins', 'disable'], danger: true, description: 'Disable a plugin' },
  'plugins.config': { args: ['plugins', 'config'], danger: true, description: 'Configure a plugin' },
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
  const timeout = options.timeout ?? 60000

  const startTime = Date.now()
  let stdout = ''
  let stderr = ''
  let timedOut = false
  let child: ChildProcess | null = null

  try {
    child = spawn(OPENCLAW_BIN, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
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
      const errorOutput: CommandOutput = { type: 'stderr', chunk: `Command not found: ${OPENCLAW_BIN}\n` }
      yield errorOutput
      await options.onChunk?.(errorOutput)

      const exitOutput: CommandOutput = { type: 'exit', code: 127 }
      yield exitOutput
      await options.onChunk?.(exitOutput)

      return {
        exitCode: 127,
        durationMs,
        stdout,
        stderr: stderr + `Command not found: ${OPENCLAW_BIN}\n`,
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

  try {
    const data = JSON.parse(result.stdout) as T
    return { data, exitCode: 0 }
  } catch {
    return {
      error: 'Failed to parse JSON output',
      exitCode: result.exitCode,
    }
  }
}

// ============================================================================
// DYNAMIC COMMAND EXECUTION (for commands with runtime parameters)
// ============================================================================

/**
 * Allowed dynamic commands that take runtime parameters.
 * Security: Only whitelisted command patterns are allowed.
 */
export const ALLOWED_DYNAMIC_COMMANDS = {
  'cron.runs': {
    baseArgs: ['cron', 'runs', '--json'],
    requiredParams: ['id'] as const,
    danger: false,
    description: 'Get cron job run history (requires --id)',
  },
  'cron.run': {
    baseArgs: ['cron', 'run', '--json'],
    requiredParams: ['id'] as const,
    danger: true,
    description: 'Trigger immediate execution of a cron job (requires --id)',
  },
  'cron.enable': {
    baseArgs: ['cron', 'enable', '--json'],
    requiredParams: ['id'] as const,
    danger: true,
    description: 'Enable a cron job (requires --id)',
  },
  'cron.disable': {
    baseArgs: ['cron', 'disable', '--json'],
    requiredParams: ['id'] as const,
    danger: true,
    description: 'Disable a cron job (requires --id)',
  },
  'cron.create': {
    baseArgs: ['cron', 'add', '--json'],
    requiredParams: ['name', 'schedule', 'command'] as const,
    optionalParams: ['enabled'] as const,
    danger: true,
    description: 'Create a new cron job (requires --name, --schedule, --command)',
  },
  'cron.delete': {
    baseArgs: ['cron', 'delete', '--json'],
    requiredParams: ['id'] as const,
    danger: true,
    description: 'Delete a cron job (requires --id)',
  },
  'plugins.uninstall': {
    baseArgs: ['plugins', 'uninstall', '--json'],
    requiredParams: ['id'] as const,
    danger: true,
    description: 'Uninstall a plugin (requires --id)',
  },
  'plugins.enable': {
    baseArgs: ['plugins', 'enable', '--json'],
    requiredParams: ['id'] as const,
    danger: true,
    description: 'Enable a plugin (requires --id)',
  },
  'plugins.disable': {
    baseArgs: ['plugins', 'disable', '--json'],
    requiredParams: ['id'] as const,
    danger: true,
    description: 'Disable a plugin (requires --id)',
  },
} as const

export type AllowedDynamicCommandId = keyof typeof ALLOWED_DYNAMIC_COMMANDS

/**
 * Execute a dynamic command with runtime parameters.
 * Security: Parameters are validated and only whitelisted commands are allowed.
 */
export async function runDynamicCommandJson<T = unknown>(
  commandId: AllowedDynamicCommandId,
  params: Record<string, string>,
  options: Omit<StreamingCommandOptions, 'onChunk'> = {}
): Promise<{ data?: T; error?: string; exitCode: number }> {
  const spec = ALLOWED_DYNAMIC_COMMANDS[commandId]
  if (!spec) {
    return { error: `Unknown dynamic command: ${commandId}`, exitCode: 1 }
  }

  // Validate required params
  for (const param of spec.requiredParams) {
    if (!params[param]) {
      return { error: `Missing required parameter: ${param}`, exitCode: 1 }
    }
  }

  // Build args with parameters
  const args: string[] = [...spec.baseArgs]
  for (const [key, value] of Object.entries(params)) {
    // Security: Validate param values (alphanumeric + dash/underscore only)
    if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
      return { error: `Invalid parameter value for ${key}: ${value}`, exitCode: 1 }
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
  const _startTime = Date.now() // Reserved for future latency tracking

  try {
    const child = spawn(OPENCLAW_BIN, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
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

    try {
      const data = JSON.parse(stdout) as T
      return { data, exitCode: 0 }
    } catch {
      return { error: 'Failed to parse JSON output', exitCode }
    }
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'Unknown error',
      exitCode: 1,
    }
  }
}
