/**
 * Shared OpenClaw error classification utilities.
 */

export type OpenClawErrorCode =
  | 'CLI_UNAVAILABLE'
  | 'CLI_JSON_PARSE_FAILED'
  | 'OPENCLAW_COMMAND_FAILED'

const CLI_INSTALL_HINT =
  "Install OpenClaw from https://github.com/openclaw/openclaw and ensure 'openclaw' is on PATH. If installed via pnpm, add PNPM_HOME (for example '$HOME/Library/pnpm') to PATH, or set OPENCLAW_BIN to the full binary path."

const JSON_PARSE_HINT =
  'OpenClaw returned non-JSON output. Retry once; if it persists, check plugin startup logs and command output.'

export function isCliUnavailableErrorMessage(message: string | null | undefined): boolean {
  if (!message) return false
  const lowered = message.toLowerCase()
  return (
    lowered.includes('openclaw cli not available')
    || lowered.includes('openclaw cli not found')
    || lowered.includes('cli not found')
    || lowered.includes('command not found')
    || lowered.includes('spawn enoent')
    || lowered.includes('enoent')
  )
}

export function classifyOpenClawError(
  message: string | null | undefined,
  options: { parseFailed?: boolean } = {}
): { code: OpenClawErrorCode; fixHint?: string } {
  if (options.parseFailed) {
    return {
      code: 'CLI_JSON_PARSE_FAILED',
      fixHint: JSON_PARSE_HINT,
    }
  }

  if (isCliUnavailableErrorMessage(message)) {
    return {
      code: 'CLI_UNAVAILABLE',
      fixHint: CLI_INSTALL_HINT,
    }
  }

  return {
    code: 'OPENCLAW_COMMAND_FAILED',
  }
}

export function buildOpenClawErrorPayload(
  error: string,
  options: { parseFailed?: boolean } = {}
): { error: string; code: OpenClawErrorCode; fixHint?: string } {
  return {
    error,
    ...classifyOpenClawError(error, options),
  }
}
