import { NextResponse } from 'next/server'
import { getOpenClawConfig } from '@/lib/openclaw-client'
import { readSettings, writeSettings } from '@/lib/settings/store'
import type { ClawcontrolSettings, RemoteAccessMode } from '@/lib/settings/types'
import { invalidateWorkspaceRootCache } from '@/lib/fs/path-policy'
import { validateWorkspaceStructure } from '@/lib/workspace/validate'
import { getOpenClawRuntimeDependencyStatus } from '@/lib/openclaw/runtime-deps'
import { invalidateTemplatesCache } from '@/lib/templates'
import {
  clearWorkflowRegistryCache,
  syncResolvedWorkflowSnapshots,
} from '@/lib/workflows/registry'
import { ensureWorkspaceScaffold } from '@/lib/workspace/bootstrap'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false
  }
  return null
}

function normalizeRemoteAccessMode(value: unknown): RemoteAccessMode | null {
  const normalized = normalizeString(value)
  if (normalized === 'local_only' || normalized === 'tailscale_tunnel') {
    return normalized
  }
  return null
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  if (LOOPBACK_HOSTS.has(normalized)) return true
  return /^127(?:\.\d{1,3}){3}$/.test(normalized)
}

function isLoopbackUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return isLoopbackHostname(parsed.hostname)
  } catch {
    return false
  }
}

type LoopbackEndpointIdentity = {
  hostClass: 'ipv4' | 'ipv6'
  port: number
}

function defaultPortForProtocol(protocol: string): number {
  if (protocol === 'https:' || protocol === 'wss:') return 443
  return 80
}

function loopbackEndpointIdentity(value: string): LoopbackEndpointIdentity | null {
  try {
    const parsed = new URL(value)
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

function areGatewayEndpointsEquivalent(httpUrl: string, wsUrl: string): boolean {
  const http = loopbackEndpointIdentity(httpUrl)
  const ws = loopbackEndpointIdentity(wsUrl)
  if (!http || !ws) return false
  return http.hostClass === ws.hostClass && http.port === ws.port
}

async function applyRuntimeWorkspacePath(workspacePath: string | null | undefined): Promise<void> {
  const normalized = normalizeString(workspacePath)

  if (normalized) {
    process.env.OPENCLAW_WORKSPACE = normalized
    process.env.CLAWCONTROL_WORKSPACE_ROOT = normalized
  } else {
    delete process.env.OPENCLAW_WORKSPACE
    delete process.env.CLAWCONTROL_WORKSPACE_ROOT
  }

  invalidateWorkspaceRootCache()
  invalidateTemplatesCache()
  clearWorkflowRegistryCache()
  try {
    await syncResolvedWorkflowSnapshots({ forceReload: true })
  } catch {
    // Snapshot sync is best-effort during workspace transitions.
  }
}

async function buildResponseData() {
  const [settingsResult, resolved, runtimeCli] = await Promise.all([
    readSettings(),
    getOpenClawConfig(true),
    getOpenClawRuntimeDependencyStatus(),
  ])

  const settings = settingsResult.settings
  const workspacePath = resolved?.workspacePath ?? settings.workspacePath ?? null
  const workspaceBootstrap = await ensureWorkspaceScaffold(workspacePath)
  const workspaceValidation = await validateWorkspaceStructure(workspacePath)

  return {
    settings: {
      gatewayHttpUrl: settings.gatewayHttpUrl ?? null,
      gatewayWsUrl: settings.gatewayWsUrl ?? null,
      gatewayToken: settings.gatewayToken ?? null,
      workspacePath: settings.workspacePath ?? null,
      remoteAccessMode: settings.remoteAccessMode ?? 'local_only',
      setupCompleted: settings.setupCompleted ?? false,
      updatedAt: settings.updatedAt,
    },
    resolved: resolved
      ? {
          gatewayHttpUrl: resolved.gatewayUrl,
          gatewayWsUrl: resolved.gatewayWsUrl ?? null,
          gatewayTokenSource: resolved.resolution.tokenSource,
          workspacePath: resolved.workspacePath,
          source: resolved.source,
          configPath: resolved.configPath,
          configPaths: resolved.configPaths,
          gatewayUrlSource: resolved.resolution.gatewayUrlSource,
          gatewayWsUrlSource: resolved.resolution.gatewayWsUrlSource,
          workspaceSource: resolved.resolution.workspaceSource,
        }
      : null,
    settingsPath: settingsResult.path,
    legacyEnvPath: settingsResult.legacyEnvPath,
    migratedFromEnv: settingsResult.migratedFromEnv,
    workspaceValidation,
    workspaceBootstrap,
    runtime: {
      cli: runtimeCli,
    },
  }
}

export async function GET() {
  try {
    const data = await buildResponseData()
    return NextResponse.json({ data })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load settings' },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      )
    }

    const patch: Record<string, unknown> = {}

    if ('gatewayHttpUrl' in body) {
      patch.gatewayHttpUrl = normalizeString(body.gatewayHttpUrl)
    }

    if ('gatewayWsUrl' in body) {
      patch.gatewayWsUrl = normalizeString(body.gatewayWsUrl)
    }

    if ('gatewayToken' in body) {
      patch.gatewayToken = normalizeString(body.gatewayToken)
    }

    if ('workspacePath' in body) {
      patch.workspacePath = normalizeString(body.workspacePath)
    }

    if ('remoteAccessMode' in body) {
      const parsed = normalizeRemoteAccessMode(body.remoteAccessMode)
      if (parsed === null) {
        return NextResponse.json(
          {
            error: 'remoteAccessMode must be "local_only" or "tailscale_tunnel"',
            code: 'INVALID_REMOTE_ACCESS_MODE',
          },
          { status: 400 }
        )
      }
      patch.remoteAccessMode = parsed
    }

    if ('setupCompleted' in body) {
      const parsed = normalizeBoolean(body.setupCompleted)
      if (parsed === null) {
        return NextResponse.json(
          { error: 'setupCompleted must be a boolean' },
          { status: 400 }
        )
      }
      patch.setupCompleted = parsed
    }

    if (typeof patch.gatewayHttpUrl === 'string' && !isLoopbackUrl(patch.gatewayHttpUrl)) {
      return NextResponse.json(
        {
          error: 'Gateway HTTP URL must use a loopback host (127.0.0.1, localhost, or ::1).',
          code: 'NON_LOOPBACK_FORBIDDEN',
        },
        { status: 400 }
      )
    }

    if (typeof patch.gatewayWsUrl === 'string' && !isLoopbackUrl(patch.gatewayWsUrl)) {
      return NextResponse.json(
        {
          error: 'Gateway WebSocket URL must use a loopback host (127.0.0.1, localhost, or ::1).',
          code: 'NON_LOOPBACK_FORBIDDEN',
        },
        { status: 400 }
      )
    }

    const currentSettings = (await readSettings()).settings
    const effectiveGatewayHttpUrl =
      Object.prototype.hasOwnProperty.call(patch, 'gatewayHttpUrl')
        ? (patch.gatewayHttpUrl as string | null)
        : (currentSettings.gatewayHttpUrl ?? null)
    const effectiveGatewayWsUrl =
      Object.prototype.hasOwnProperty.call(patch, 'gatewayWsUrl')
        ? (patch.gatewayWsUrl as string | null)
        : (currentSettings.gatewayWsUrl ?? null)

    if (
      typeof effectiveGatewayHttpUrl === 'string'
      && typeof effectiveGatewayWsUrl === 'string'
      && !areGatewayEndpointsEquivalent(effectiveGatewayHttpUrl, effectiveGatewayWsUrl)
    ) {
      return NextResponse.json(
        {
          error: 'Gateway HTTP and WebSocket URLs must target the same loopback host class and port.',
          code: 'GATEWAY_ENDPOINT_MISMATCH',
        },
        { status: 400 }
      )
    }

    const saved = await writeSettings(patch as Partial<ClawcontrolSettings>)

    if ('workspacePath' in patch) {
      await applyRuntimeWorkspacePath(saved.settings.workspacePath ?? null)
    }

    const data = await buildResponseData()

    return NextResponse.json({
      data,
      message: 'Settings saved successfully',
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to save settings' },
      { status: 500 }
    )
  }
}
