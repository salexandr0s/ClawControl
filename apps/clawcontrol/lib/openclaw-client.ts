import 'server-only'

import {
  checkGatewayHealth,
  discoverLocalConfig,
  probeGatewayHealth,
  type DiscoveredConfig,
  type GatewayProbeStatus,
  type GatewayProbeState,
} from '@clawcontrol/adapters-openclaw'
import {
  readSettings,
  readSettingsSync,
} from '@/lib/settings/store'
import {
  DEFAULT_GATEWAY_HTTP_URL,
  DEFAULT_GATEWAY_WS_URL,
} from '@/lib/settings/types'

export interface ResolvedOpenClawConfig extends DiscoveredConfig {
  resolution: {
    gatewayUrlSource: 'settings' | 'env' | 'openclaw'
    gatewayWsUrlSource: 'settings' | 'env' | 'openclaw'
    tokenSource: 'settings' | 'env' | 'openclaw' | 'none'
    workspaceSource: 'settings' | 'env' | 'openclaw' | 'none'
  }
}

export interface GatewayRetryResult {
  available: boolean
  state: GatewayProbeState
  attempts: number
  probe: GatewayProbeStatus | null
}

let cachedConfig: ResolvedOpenClawConfig | null = null
let lastCheckMs = 0
const CACHE_TTL_MS = 60_000
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  if (LOOPBACK_HOSTS.has(normalized)) return true
  return /^127(?:\.\d{1,3}){3}$/.test(normalized)
}

function isLoopbackUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return isLoopbackHostname(parsed.hostname)
  } catch {
    return false
  }
}

type LoopbackEndpointIdentity = {
  hostClass: 'ipv4' | 'ipv6'
  port: number
}

type ConfigSource = 'settings' | 'env' | 'openclaw'

function defaultPortForProtocol(protocol: string): number {
  if (protocol === 'https:' || protocol === 'wss:') return 443
  return 80
}

function loopbackEndpointIdentity(url: string): LoopbackEndpointIdentity | null {
  try {
    const parsed = new URL(url)
    if (!isLoopbackHostname(parsed.hostname)) return null

    const host = parsed.hostname.trim().toLowerCase()
    const hostClass = host === '::1' || host === '[::1]' ? 'ipv6' : 'ipv4'
    const explicitPort = Number(parsed.port)
    const port = Number.isFinite(explicitPort) && explicitPort > 0
      ? explicitPort
      : defaultPortForProtocol(parsed.protocol)

    return { hostClass, port }
  } catch {
    return null
  }
}

function areLoopbackEndpointsEquivalent(first: string, second: string): boolean {
  const a = loopbackEndpointIdentity(first)
  const b = loopbackEndpointIdentity(second)
  if (!a || !b) return false
  return a.hostClass === b.hostClass && a.port === b.port
}

function pickFirstLoopbackUrl(
  candidates: Array<{ value: string | null; source: ConfigSource }>
): { value: string | null; source: ConfigSource | null } {
  for (const candidate of candidates) {
    if (candidate.value && isLoopbackUrl(candidate.value)) {
      return { value: candidate.value, source: candidate.source }
    }
  }
  return { value: null, source: null }
}

function toWsUrl(httpUrl: string): string {
  if (httpUrl.startsWith('https://')) return `wss://${httpUrl.slice('https://'.length)}`
  if (httpUrl.startsWith('http://')) return `ws://${httpUrl.slice('http://'.length)}`
  if (httpUrl.startsWith('ws://') || httpUrl.startsWith('wss://')) return httpUrl
  return `ws://${httpUrl}`
}

function resolveGatewayPair(input: {
  httpCandidates: Array<{ value: string | null; source: ConfigSource }>
  wsCandidates: Array<{ value: string | null; source: ConfigSource }>
  defaultWsUrl?: string
}): {
  gatewayUrl: string
  gatewayWsUrl: string
  gatewayUrlSource: ConfigSource
  gatewayWsUrlSource: ConfigSource
} {
  const httpSelection = pickFirstLoopbackUrl(input.httpCandidates)
  const gatewayUrl = httpSelection.value || DEFAULT_GATEWAY_HTTP_URL
  const gatewayUrlSource = httpSelection.source || 'openclaw'

  const sameSourceWs = input.wsCandidates.find((candidate) => (
    candidate.source === gatewayUrlSource
    && typeof candidate.value === 'string'
    && isLoopbackUrl(candidate.value)
  ))

  if (sameSourceWs && sameSourceWs.value && areLoopbackEndpointsEquivalent(gatewayUrl, sameSourceWs.value)) {
    return {
      gatewayUrl,
      gatewayWsUrl: sameSourceWs.value,
      gatewayUrlSource,
      gatewayWsUrlSource: gatewayUrlSource,
    }
  }

  const derivedWsUrl = toWsUrl(gatewayUrl) || input.defaultWsUrl || DEFAULT_GATEWAY_WS_URL
  return {
    gatewayUrl,
    gatewayWsUrl: derivedWsUrl,
    gatewayUrlSource,
    gatewayWsUrlSource: gatewayUrlSource,
  }
}

function hasMeaningfulSettings(config: {
  gatewayHttpUrl?: string
  gatewayWsUrl?: string
  gatewayToken?: string
  workspacePath?: string
}): boolean {
  return Boolean(
    normalizeString(config.gatewayHttpUrl)
    || normalizeString(config.gatewayWsUrl)
    || normalizeString(config.gatewayToken)
    || normalizeString(config.workspacePath)
  )
}

async function resolveConfig(): Promise<ResolvedOpenClawConfig | null> {
  const [discovered, settingsResult] = await Promise.all([
    discoverLocalConfig(),
    readSettings(),
  ])

  const settings = settingsResult.settings

  const envGatewayUrl = normalizeString(process.env.OPENCLAW_GATEWAY_HTTP_URL)
  const envGatewayWsUrl = normalizeString(process.env.OPENCLAW_GATEWAY_WS_URL)
  const envGatewayToken = normalizeString(process.env.OPENCLAW_GATEWAY_TOKEN)
  const envWorkspace = normalizeString(process.env.OPENCLAW_WORKSPACE)

  const settingsGatewayUrl = normalizeString(settings.gatewayHttpUrl)
  const settingsGatewayWsUrl = normalizeString(settings.gatewayWsUrl)
  const settingsGatewayToken = normalizeString(settings.gatewayToken)
  const settingsWorkspace = normalizeString(settings.workspacePath)

  const discoveredGatewayUrl = normalizeString(discovered?.gatewayUrl)
  const discoveredGatewayWsUrl = normalizeString(discovered?.gatewayWsUrl)
  const discoveredToken = normalizeString(discovered?.token)
  const discoveredWorkspace = normalizeString(discovered?.workspacePath)

  const hasSettings = hasMeaningfulSettings(settings)
  const hasEnv = Boolean(envGatewayUrl || envGatewayWsUrl || envGatewayToken || envWorkspace)
  if (!discovered && !hasSettings && !hasEnv) {
    return null
  }

  const resolvedGateway = resolveGatewayPair({
    httpCandidates: [
      { value: settingsGatewayUrl, source: 'settings' },
      { value: envGatewayUrl, source: 'env' },
      { value: discoveredGatewayUrl, source: 'openclaw' },
    ],
    wsCandidates: [
      { value: settingsGatewayWsUrl, source: 'settings' },
      { value: envGatewayWsUrl, source: 'env' },
      { value: discoveredGatewayWsUrl, source: 'openclaw' },
    ],
    defaultWsUrl: DEFAULT_GATEWAY_WS_URL,
  })
  const gatewayUrl = resolvedGateway.gatewayUrl
  const gatewayUrlSource = resolvedGateway.gatewayUrlSource
  const gatewayWsUrl = resolvedGateway.gatewayWsUrl
  const gatewayWsUrlSource = resolvedGateway.gatewayWsUrlSource

  const token =
    settingsGatewayToken
    || envGatewayToken
    || discoveredToken
    || null

  const workspacePath =
    settingsWorkspace
    || envWorkspace
    || discoveredWorkspace
    || null

  const configPath =
    discovered?.configPath
    || settingsResult.path

  const configPaths = discovered?.configPaths ?? [settingsResult.path]

  return {
    gatewayUrl,
    gatewayWsUrl,
    token,
    workspacePath,
    agents: discovered?.agents ?? [],
    configPath,
    configPaths,
    source: discovered?.source ?? 'filesystem',
    resolution: {
      gatewayUrlSource,
      gatewayWsUrlSource,
      tokenSource:
        settingsGatewayToken
          ? 'settings'
          : envGatewayToken
            ? 'env'
            : discoveredToken
              ? 'openclaw'
              : 'none',
      workspaceSource:
        settingsWorkspace
          ? 'settings'
          : envWorkspace
            ? 'env'
            : discoveredWorkspace
              ? 'openclaw'
              : 'none',
    },
  }
}

export async function getOpenClawConfig(forceRefresh = false): Promise<ResolvedOpenClawConfig | null> {
  const now = Date.now()

  if (!forceRefresh && cachedConfig && (now - lastCheckMs) < CACHE_TTL_MS) {
    return cachedConfig
  }

  cachedConfig = await resolveConfig()
  lastCheckMs = now
  return cachedConfig
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function waitForGatewayAvailability(
  config: Pick<ResolvedOpenClawConfig, 'gatewayUrl' | 'token'>,
  retryDelaysMs: number[] = [0, 1000, 2000, 4000, 8000]
): Promise<GatewayRetryResult> {
  let lastProbe: GatewayProbeStatus | null = null

  for (let i = 0; i < retryDelaysMs.length; i += 1) {
    const delay = retryDelaysMs[i] ?? 0
    if (delay > 0) {
      await sleep(delay)
    }

    lastProbe = await probeGatewayHealth(config.gatewayUrl, config.token ?? undefined)
    if (lastProbe.ok || lastProbe.state === 'auth_required') {
      return {
        available: lastProbe.ok,
        state: lastProbe.state,
        attempts: i + 1,
        probe: lastProbe,
      }
    }
  }

  return {
    available: false,
    state: lastProbe?.state ?? 'unreachable',
    attempts: retryDelaysMs.length,
    probe: lastProbe,
  }
}

export async function isGatewayOnline(): Promise<boolean> {
  const config = await getOpenClawConfig()
  if (!config) return false
  return checkGatewayHealth(config.gatewayUrl, config.token ?? undefined)
}

export function getOpenClawConfigSync(): ResolvedOpenClawConfig | null {
  const settingsResult = readSettingsSync()
  const settings = settingsResult.settings

  const settingsGatewayUrl = normalizeString(settings.gatewayHttpUrl)
  const settingsGatewayWsUrl = normalizeString(settings.gatewayWsUrl)
  const settingsGatewayToken = normalizeString(settings.gatewayToken)
  const settingsWorkspace = normalizeString(settings.workspacePath)

  const envGatewayUrl = normalizeString(process.env.OPENCLAW_GATEWAY_HTTP_URL)
  const envGatewayWsUrl = normalizeString(process.env.OPENCLAW_GATEWAY_WS_URL)
  const envGatewayToken = normalizeString(process.env.OPENCLAW_GATEWAY_TOKEN)
  const envWorkspace = normalizeString(process.env.OPENCLAW_WORKSPACE)

  if (!hasMeaningfulSettings(settings) && !envGatewayUrl && !envGatewayWsUrl && !envGatewayToken && !envWorkspace) {
    return null
  }

  const resolvedGateway = resolveGatewayPair({
    httpCandidates: [
      { value: settingsGatewayUrl, source: 'settings' },
      { value: envGatewayUrl, source: 'env' },
    ],
    wsCandidates: [
      { value: settingsGatewayWsUrl, source: 'settings' },
      { value: envGatewayWsUrl, source: 'env' },
    ],
    defaultWsUrl: DEFAULT_GATEWAY_WS_URL,
  })
  const gatewayUrl = resolvedGateway.gatewayUrl
  const gatewayUrlSource = resolvedGateway.gatewayUrlSource
  const gatewayWsUrl = resolvedGateway.gatewayWsUrl
  const gatewayWsUrlSource = resolvedGateway.gatewayWsUrlSource
  const token = settingsGatewayToken || envGatewayToken || null
  const workspacePath = settingsWorkspace || envWorkspace || null

  return {
    gatewayUrl,
    gatewayWsUrl,
    token,
    workspacePath,
    agents: [],
    configPath: settingsResult.path,
    configPaths: [settingsResult.path],
    source: 'filesystem',
    resolution: {
      gatewayUrlSource,
      gatewayWsUrlSource,
      tokenSource: settingsGatewayToken ? 'settings' : envGatewayToken ? 'env' : 'none',
      workspaceSource: settingsWorkspace ? 'settings' : envWorkspace ? 'env' : 'none',
    },
  }
}
