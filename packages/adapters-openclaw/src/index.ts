/**
 * @savorgos/adapters-openclaw
 *
 * OpenClaw adapter with multiple modes:
 * - mock: For development/testing
 * - local_cli: Default - uses local `openclaw` or `clawdbot` CLI commands
 * - remote_http: Optional - HTTP API for remote Gateway
 * - remote_ws: Optional - WebSocket for richer events
 * - remote_cli_over_ssh: Fallback - SSH tunnel to remote CLI
 *
 * Binary Resolution:
 * Supports both 'openclaw' (new) and 'clawdbot' (legacy) binaries.
 * Set OPENCLAW_BIN env var to override auto-detection.
 */

export * from './types'
export * from './adapter'
export * from './command-runner'
export * from './resolve-bin'
