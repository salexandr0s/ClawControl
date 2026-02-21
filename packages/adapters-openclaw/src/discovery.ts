import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { load as loadYaml } from 'js-yaml'

export interface DiscoveredConfig {
  gatewayUrl: string
  gatewayWsUrl?: string
  token: string | null
  agents: DiscoveredAgent[]
  workspacePath: string | null
  configPath: string
  configPaths: string[]
  source: 'openclaw.json' | 'moltbot.json' | 'clawdbot.json' | 'config.yaml' | 'filesystem'
}

export interface DiscoveredAgent {
  id: string
  identity?: string
  model?: string
  fallbacks?: string[]
  agentDir?: string
}

export type GatewayProbeState = 'reachable' | 'auth_required' | 'unreachable'

export interface GatewayProbeStatus {
  ok: boolean
  state: GatewayProbeState
  url: string
  latencyMs: number
  statusCode?: number
  error?: string
}

interface ParsedConfigFile {
  filePath: string
  fileName: string
  configDir: string
  data: Record<string, unknown>
}

// Preserve historical search order while also accepting an uppercase alias.
const CONFIG_DIR_GROUPS = [
  ['.openclaw', '.OpenClaw'],
  ['.moltbot'],
  ['.clawdbot'],
] as const
const CONFIG_FILE_ORDER = ['openclaw.json', 'moltbot.json', 'clawdbot.json', 'config.yaml'] as const
const WORKSPACE_DIR_ORDER = ['openclaw', 'OpenClaw', 'moltbot', 'clawd'] as const

const DEFAULT_GATEWAY_HTTP_URL = 'http://127.0.0.1:18789'
const DEFAULT_GATEWAY_WS_URL = 'ws://127.0.0.1:18789'

function pathKey(input: string): string {
  const normalized = path.resolve(input)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined

  const items = value
    .map((item) => asString(item))
    .filter((item): item is string => Boolean(item))

  return items.length > 0 ? items : undefined
}

function extractModelPrimary(value: unknown): string | undefined {
  if (typeof value === 'string') return asString(value)
  if (!value || typeof value !== 'object') return undefined

  const node = value as {
    primary?: unknown
    model?: unknown
    id?: unknown
    key?: unknown
  }

  return (
    asString(node.primary)
    || asString(node.model)
    || asString(node.id)
    || asString(node.key)
  )
}

function extractModelFallbacks(value: unknown): string[] | undefined {
  if (!value || typeof value !== 'object') return undefined
  const node = value as { fallbacks?: unknown }
  if (!Object.prototype.hasOwnProperty.call(node, 'fallbacks')) return undefined
  return asStringArray(node.fallbacks) ?? []
}

function normalizeUrl(input: string | undefined, defaultScheme: 'http' | 'ws'): string | undefined {
  if (!input) return undefined
  const trimmed = input.trim()
  if (!trimmed) return undefined

  try {
    const parsed = new URL(trimmed)
    return parsed.toString().replace(/\/$/, '')
  } catch {
    try {
      const parsed = new URL(`${defaultScheme}://${trimmed}`)
      return parsed.toString().replace(/\/$/, '')
    } catch {
      return undefined
    }
  }
}

function toWsUrl(httpUrl: string): string {
  if (httpUrl.startsWith('https://')) return `wss://${httpUrl.slice('https://'.length)}`
  if (httpUrl.startsWith('http://')) return `ws://${httpUrl.slice('http://'.length)}`
  if (httpUrl.startsWith('wss://') || httpUrl.startsWith('ws://')) return httpUrl
  return `ws://${httpUrl}`
}

function toHttpUrl(wsUrl: string): string {
  if (wsUrl.startsWith('wss://')) return `https://${wsUrl.slice('wss://'.length)}`
  if (wsUrl.startsWith('ws://')) return `http://${wsUrl.slice('ws://'.length)}`
  if (wsUrl.startsWith('https://') || wsUrl.startsWith('http://')) return wsUrl
  return `http://${wsUrl}`
}

function asPort(value: unknown): number | undefined {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return undefined

  const port = Math.trunc(num)
  if (port < 1 || port > 65535) return undefined
  return port
}

function hostFromBind(value: string | undefined): string | undefined {
  if (!value) return undefined

  const bind = value.trim().toLowerCase()
  if (!bind) return undefined
  if (bind === 'loopback' || bind === 'localhost') return '127.0.0.1'
  if (bind === 'all' || bind === '0.0.0.0' || bind === '::' || bind === '[::]') return '127.0.0.1'
  return value.trim()
}

function sourceFromFileName(fileName: string): DiscoveredConfig['source'] {
  if (fileName === 'openclaw.json') return 'openclaw.json'
  if (fileName === 'moltbot.json') return 'moltbot.json'
  if (fileName === 'clawdbot.json') return 'clawdbot.json'
  if (fileName === 'config.yaml') return 'config.yaml'
  return 'filesystem'
}

function resolveWorkspacePath(input: string, homeDir: string, configDir: string): string {
  const trimmed = input.trim()
  if (!trimmed) return path.resolve(configDir)
  if (trimmed === '~') return path.resolve(homeDir)
  if (trimmed.startsWith('~/')) return path.resolve(homeDir, trimmed.slice(2))
  if (path.isAbsolute(trimmed)) return path.resolve(trimmed)
  return path.resolve(configDir, trimmed)
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function getRealPath(targetPath: string): Promise<string> {
  try {
    return await fs.realpath(targetPath)
  } catch {
    return path.resolve(targetPath)
  }
}

async function discoverConfigDirs(homeDir: string): Promise<string[]> {
  const dirs: string[] = []
  const seen = new Set<string>()

  for (const dirGroup of CONFIG_DIR_GROUPS) {
    for (const dirName of dirGroup) {
      const candidate = path.join(homeDir, dirName)
      if (!(await pathExists(candidate))) continue

      let stat
      try {
        stat = await fs.stat(candidate)
      } catch {
        continue
      }

      if (!stat.isDirectory()) continue

      const real = await getRealPath(candidate)
      const key = pathKey(real)
      if (seen.has(key)) continue

      seen.add(key)
      dirs.push(candidate)
    }
  }

  return dirs
}

async function parseConfigFile(filePath: string, fileName: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')

    if (fileName.endsWith('.yaml') || fileName.endsWith('.yml')) {
      return toRecord(loadYaml(raw))
    }

    return toRecord(JSON.parse(raw))
  } catch {
    return null
  }
}

async function discoverConfigFiles(homeDir: string): Promise<ParsedConfigFile[]> {
  const configDirs = await discoverConfigDirs(homeDir)
  const results: ParsedConfigFile[] = []
  const seenFiles = new Set<string>()

  for (const configDir of configDirs) {
    for (const fileName of CONFIG_FILE_ORDER) {
      const filePath = path.join(configDir, fileName)
      if (!(await pathExists(filePath))) continue

      const real = await getRealPath(filePath)
      const key = pathKey(real)
      if (seenFiles.has(key)) continue

      const parsed = await parseConfigFile(filePath, fileName)
      if (!parsed) continue

      seenFiles.add(key)
      results.push({
        filePath,
        fileName,
        configDir,
        data: parsed,
      })
    }
  }

  return results
}

function extractGatewayUrls(config: Record<string, unknown>): { httpUrl?: string; wsUrl?: string } {
  const remote = toRecord(config.remote)
  const gateway = toRecord(config.gateway)

  const explicitHttp =
    asString(remote?.url)
    || asString(gateway?.url)
    || asString(gateway?.httpUrl)
    || asString(gateway?.http_url)

  const explicitWs =
    asString(remote?.wsUrl)
    || asString(remote?.ws_url)
    || asString(gateway?.wsUrl)
    || asString(gateway?.ws_url)

  const normalizedHttp = normalizeUrl(explicitHttp, 'http')
  const normalizedWs = normalizeUrl(explicitWs, 'ws')

  if (normalizedHttp || normalizedWs) {
    return {
      httpUrl: normalizedHttp ?? (normalizedWs ? toHttpUrl(normalizedWs) : undefined),
      wsUrl: normalizedWs ?? (normalizedHttp ? toWsUrl(normalizedHttp) : undefined),
    }
  }

  const port = asPort(gateway?.port) ?? 18789
  const host =
    asString(gateway?.host)
    || asString(gateway?.bindAddress)
    || asString(gateway?.bind_address)
    || hostFromBind(asString(gateway?.bind))
    || '127.0.0.1'

  const protocol = asString(gateway?.protocol)?.toLowerCase()
  const tlsEnabled =
    protocol === 'https'
    || protocol === 'wss'
    || gateway?.https === true
    || toRecord(gateway?.tls)?.enabled === true

  const httpScheme = tlsEnabled ? 'https' : 'http'
  const wsScheme = tlsEnabled ? 'wss' : 'ws'

  return {
    httpUrl: `${httpScheme}://${host}:${port}`,
    wsUrl: `${wsScheme}://${host}:${port}`,
  }
}

function extractToken(config: Record<string, unknown>): string | null {
  const remote = toRecord(config.remote)
  const gateway = toRecord(config.gateway)

  return (
    asString(remote?.token)
    || asString(toRecord(gateway?.auth)?.token)
    || asString(toRecord(config.auth)?.token)
    || asString(config.token)
    || asString(config.operator_token)
    || null
  )
}

function extractWorkspace(config: Record<string, unknown>, homeDir: string, configDir: string): string | null {
  const agents = toRecord(config.agents)
  const defaults = toRecord(agents?.defaults)

  const workspace =
    asString(defaults?.workspace)
    || asString(config.workspace)
    || null

  if (!workspace) return null
  return resolveWorkspacePath(workspace, homeDir, configDir)
}

function extractAgents(config: Record<string, unknown>): DiscoveredAgent[] {
  const agentsNode = config.agents
  const agentsRecord = toRecord(agentsNode)

  const defs: unknown[] =
    (Array.isArray(agentsRecord?.definitions)
      ? (agentsRecord?.definitions as unknown[])
      : null)
    || (Array.isArray(agentsRecord?.list)
      ? (agentsRecord?.list as unknown[])
      : null)
    || (Array.isArray(agentsNode) ? agentsNode : null)
    || []

  const out: DiscoveredAgent[] = []

  for (const entry of defs) {
    const agent = toRecord(entry)
    const id = asString(agent?.id)
    if (!id) continue

    const identity =
      asString(agent?.identity)
      || asString(toRecord(agent?.identity)?.name)
      || asString(agent?.name)

    const model = extractModelPrimary(agent?.model)
    const fallbacks = extractModelFallbacks(agent?.model)

    out.push({
      id,
      ...(identity ? { identity } : {}),
      ...(model ? { model } : {}),
      ...(fallbacks ? { fallbacks } : {}),
      ...(asString(agent?.agentDir) ? { agentDir: asString(agent?.agentDir) } : {}),
    })
  }

  return out
}

async function discoverAgentsFromFilesystem(configDirs: string[]): Promise<DiscoveredAgent[]> {
  const out: DiscoveredAgent[] = []

  for (const configDir of configDirs) {
    const agentsDir = path.join(configDir, 'agents')
    if (!(await pathExists(agentsDir))) continue

    let stat
    try {
      stat = await fs.stat(agentsDir)
    } catch {
      continue
    }

    if (!stat.isDirectory()) continue

    let entries
    try {
      entries = await fs.readdir(agentsDir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      out.push({
        id: entry.name,
        identity: entry.name,
        agentDir: path.join(agentsDir, entry.name, 'agent'),
      })
    }
  }

  return out
}

async function discoverWorkspaceFallback(homeDir: string): Promise<string | null> {
  const seen = new Set<string>()

  for (const dirName of WORKSPACE_DIR_ORDER) {
    const candidate = path.join(homeDir, dirName)
    if (!(await pathExists(candidate))) continue

    let stat
    try {
      stat = await fs.stat(candidate)
    } catch {
      continue
    }

    if (!stat.isDirectory()) continue

    const real = await getRealPath(candidate)
    const key = pathKey(real)
    if (seen.has(key)) continue

    seen.add(key)
    return real
  }

  return null
}

function mergeAgents(...sources: DiscoveredAgent[][]): DiscoveredAgent[] {
  const merged = new Map<string, DiscoveredAgent>()

  for (const source of sources) {
    for (const agent of source) {
      const key = agent.id.trim().toLowerCase()
      if (!key) continue

      const existing = merged.get(key)
      if (!existing) {
        merged.set(key, { ...agent })
        continue
      }

      merged.set(key, {
        ...agent,
        ...existing,
      })
    }
  }

  return Array.from(merged.values())
}

/**
 * Discover OpenClaw configuration from local filesystem.
 *
 * Config directories are checked in order:
 * 1) ~/.openclaw/
 *    - Alias: ~/.OpenClaw/
 * 2) ~/.moltbot/
 * 3) ~/.clawdbot/
 *
 * Config file names are checked in order:
 * - openclaw.json
 * - moltbot.json
 * - clawdbot.json
 * - config.yaml
 */
export async function discoverLocalConfig(): Promise<DiscoveredConfig | null> {
  const homeDir = os.homedir()

  const [configFiles, configDirs] = await Promise.all([
    discoverConfigFiles(homeDir),
    discoverConfigDirs(homeDir),
  ])

  let httpUrl: string | undefined
  let wsUrl: string | undefined
  let token: string | null = null
  let workspacePath: string | null = null

  for (const configFile of configFiles) {
    if (!httpUrl || !wsUrl) {
      const gateway = extractGatewayUrls(configFile.data)
      if (!httpUrl && gateway.httpUrl) httpUrl = gateway.httpUrl
      if (!wsUrl && gateway.wsUrl) wsUrl = gateway.wsUrl
    }

    if (!token) {
      token = extractToken(configFile.data)
    }

    if (!workspacePath) {
      workspacePath = extractWorkspace(configFile.data, homeDir, configFile.configDir)
    }

    if (httpUrl && wsUrl && token && workspacePath) {
      break
    }
  }

  if (!workspacePath) {
    workspacePath = await discoverWorkspaceFallback(homeDir)
  }

  const configAgents = configFiles.flatMap((entry) => extractAgents(entry.data))
  const filesystemAgents = await discoverAgentsFromFilesystem(configDirs)
  const agents = mergeAgents(configAgents, filesystemAgents)

  if (configFiles.length === 0 && configDirs.length === 0 && agents.length === 0 && !workspacePath) {
    return null
  }

  const selectedConfig = configFiles[0]

  return {
    gatewayUrl: httpUrl ?? DEFAULT_GATEWAY_HTTP_URL,
    gatewayWsUrl: wsUrl ?? toWsUrl(httpUrl ?? DEFAULT_GATEWAY_HTTP_URL) ?? DEFAULT_GATEWAY_WS_URL,
    token,
    workspacePath,
    agents,
    configPath: selectedConfig?.filePath ?? configDirs[0] ?? workspacePath ?? path.join(homeDir, '.openclaw'),
    configPaths: configFiles.map((entry) => entry.filePath),
    source: selectedConfig ? sourceFromFileName(selectedConfig.fileName) : 'filesystem',
  }
}

function withTimeout(ms: number): { controller: AbortController; cancel: () => void } {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), ms)
  ;(id as unknown as { unref?: () => void })?.unref?.()
  return { controller, cancel: () => clearTimeout(id) }
}

function normalizeHealthBaseUrl(url: string): string {
  const trimmed = url.trim()
  if (trimmed.startsWith('ws://')) return `http://${trimmed.slice('ws://'.length)}`
  if (trimmed.startsWith('wss://')) return `https://${trimmed.slice('wss://'.length)}`
  return trimmed
}

export async function probeGatewayHealth(url: string, token?: string): Promise<GatewayProbeStatus> {
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`

  const base = normalizeHealthBaseUrl(url)
  const endpoint = `${base.replace(/\/+$/, '')}/health`
  const start = Date.now()

  try {
    const timeout = withTimeout(3000)
    try {
      const res = await fetch(endpoint, {
        headers,
        signal: timeout.controller.signal,
      })

      const latencyMs = Date.now() - start
      if (res.status >= 200 && res.status < 300) {
        return {
          ok: true,
          state: 'reachable',
          url: endpoint,
          latencyMs,
          statusCode: res.status,
        }
      }

      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          state: 'auth_required',
          url: endpoint,
          latencyMs,
          statusCode: res.status,
          error: `HTTP ${res.status}`,
        }
      }

      return {
        ok: false,
        state: 'unreachable',
        url: endpoint,
        latencyMs,
        statusCode: res.status,
        error: `HTTP ${res.status}`,
      }
    } finally {
      timeout.cancel()
    }
  } catch (error) {
    return {
      ok: false,
      state: 'unreachable',
      url: endpoint,
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Check if OpenClaw gateway is reachable.
 *
 * Uses `${gatewayUrl}/health` (or http(s) version if gatewayUrl is ws(s)).
 */
export async function checkGatewayHealth(url: string, token?: string): Promise<boolean> {
  const result = await probeGatewayHealth(url, token)
  return result.ok
}

/**
 * Read agent SOUL.md if available.
 */
export async function readAgentSoul(agentId: string, agentDir?: string): Promise<string | null> {
  const config = await discoverLocalConfig()

  const directory =
    agentDir
    || config?.agents.find((agent) => agent.id === agentId)?.agentDir
    || path.join(os.homedir(), '.openclaw', 'agents', agentId, 'agent')

  const soulPath = path.join(directory, 'SOUL.md')

  try {
    return await fs.readFile(soulPath, 'utf-8')
  } catch {
    return null
  }
}
