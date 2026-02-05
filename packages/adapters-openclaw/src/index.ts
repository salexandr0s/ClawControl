/**
 * @clawcontrol/adapters-openclaw
 *
 * OpenClaw CLI adapter with multiple modes:
 * - mock: For development/testing when OpenClaw is not installed
 * - local_cli: Default - uses local `openclaw` CLI commands
 * - remote_http: Optional - HTTP API for remote Gateway
 * - remote_ws: WebSocket for session-scoped messaging and events
 * - remote_cli_over_ssh: Fallback - SSH tunnel to remote CLI
 *
 * Requirements:
 * - OpenClaw CLI must be installed and on PATH for operational mode
 * - Minimum version: 0.1.0
 * - Install from: https://github.com/openclaw/openclaw
 */

export * from './types'
export * from './adapter'
export * from './command-runner'
export * from './resolve-bin'
export { WsAdapter } from './ws-adapter'
export * from './discovery'
