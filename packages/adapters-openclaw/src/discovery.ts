import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

export interface DiscoveredConfig {
  gatewayUrl: string
  token: string | null
  agents: DiscoveredAgent[]
  configPath: string
}

export interface DiscoveredAgent {
  id: string
  identity?: string
  model?: string
  agentDir?: string
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function extractGatewayUrl(config: any): string {
  return (
    asString(config?.remote?.url) ||
    asString(config?.gateway?.url) ||
    asString(config?.gateway?.wsUrl) ||
    asString(config?.gateway?.ws_url) ||
    'http://127.0.0.1:3001'
  )
}

function extractToken(config: any): string | null {
  return (
    asString(config?.gateway?.auth?.token) ||
    asString(config?.auth?.token) ||
    asString(config?.token) ||
    asString(config?.operator_token) ||
    null
  )
}

function extractAgents(config: any): DiscoveredAgent[] {
  const defs: any[] =
    (Array.isArray(config?.agents?.definitions) ? config.agents.definitions : null) ||
    (Array.isArray(config?.agents) ? config.agents : null) ||
    []

  const out: DiscoveredAgent[] = []
  for (const a of defs) {
    const id = asString(a?.id)
    if (!id) continue

    const identity =
      asString(a?.identity) ||
      asString(a?.identity?.name) ||
      asString(a?.name)

    out.push({
      id,
      identity,
      model: asString(a?.model),
      agentDir: asString(a?.agentDir),
    })
  }
  return out
}

/**
 * Discover OpenClaw configuration from local filesystem.
 * Reads ~/.openclaw/openclaw.json and extracts connection + agent info.
 */
export async function discoverLocalConfig(): Promise<DiscoveredConfig | null> {
  const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json')

  try {
    const raw = await fs.readFile(configPath, 'utf-8')
    const config = JSON.parse(raw)

    return {
      configPath,
      gatewayUrl: extractGatewayUrl(config),
      token: extractToken(config),
      agents: extractAgents(config),
    }
  } catch {
    // Config not found or invalid
    return null
  }
}

function withTimeout(ms: number): { controller: AbortController; cancel: () => void } {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), ms)
  // Node: allow process to exit even if timer still pending
  ;(id as unknown as { unref?: () => void })?.unref?.()
  return { controller, cancel: () => clearTimeout(id) }
}

function normalizeHealthBaseUrl(url: string): string {
  const trimmed = url.trim()
  if (trimmed.startsWith('ws://')) return 'http://' + trimmed.slice('ws://'.length)
  if (trimmed.startsWith('wss://')) return 'https://' + trimmed.slice('wss://'.length)
  return trimmed
}

/**
 * Check if OpenClaw gateway is reachable.
 *
 * Uses `${gatewayUrl}/health` (or http(s) version if gatewayUrl is ws(s)).
 */
export async function checkGatewayHealth(url: string, token?: string): Promise<boolean> {
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  const base = normalizeHealthBaseUrl(url)

  try {
    const timeout = withTimeout(3000)
    try {
      const res = await fetch(`${base.replace(/\/+$/, '')}/health`, {
        headers,
        signal: timeout.controller.signal,
      })
      return res.ok
    } finally {
      timeout.cancel()
    }
  } catch {
    return false
  }
}

/**
 * Read agent SOUL.md if available.
 */
export async function readAgentSoul(agentId: string, agentDir?: string): Promise<string | null> {
  const dir =
    agentDir ??
    path.join(os.homedir(), '.openclaw', 'agents', agentId, 'agent')
  const soulPath = path.join(dir, 'SOUL.md')

  try {
    return await fs.readFile(soulPath, 'utf-8')
  } catch {
    return null
  }
}
