'use client'

import { useState, useEffect, type ChangeEvent } from 'react'
import { Button, SegmentedToggle, buttonLikeClass } from '@clawcontrol/ui'
import { useLayout } from '@/lib/layout-context'
import { useSettings } from '@/lib/settings-context'
import { useSyncStatus } from '@/lib/hooks/useSyncStatus'
import { InlineLoading, LoadingSpinner } from '@/components/ui/loading-state'
import {
  configApi,
  type SettingsConfigResponse,
  type GatewayTestResponse,
  type TailscaleReadinessResponse,
  type RemoteAccessMode,
} from '@/lib/http'
import { cn } from '@/lib/utils'
import { UserAvatar } from '@/components/ui/user-avatar'
import {
  Check,
  FolderOpen,
  AlertCircle,
  RefreshCw,
  Save,
  ShieldOff,
  Upload,
  Trash2,
  ArrowUpRight,
} from 'lucide-react'

type OpenClawDiscoverOk = {
  status: 'connected' | 'auth_required' | 'offline'
  gatewayUrl: string
  gatewayWsUrl: string | null
  hasToken: boolean
  workspacePath: string | null
  configPath: string
  configPaths: string[]
  source: string
  probe?: {
    statusCode?: number
    latencyMs: number
    error?: string
  }
  agentCount: number
  agents: Array<{ id: string; identity: string }>
}

type OpenClawDiscoverNotFound = {
  status: 'not_found'
  message: string
}

type OpenClawDiscoverResponse = OpenClawDiscoverOk | OpenClawDiscoverNotFound

type GatewayConnectionState = 'idle' | 'testing' | 'connected' | 'auth_required' | 'offline'

type DesktopUpdateInfo = {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  releaseUrl: string
  releaseName: string | null
  publishedAt: string | null
  notes: string | null
  error?: string
}

type OpenClawUpdateInfo = {
  latestVersion: string | null
  releaseUrl: string
  releaseName: string | null
  publishedAt: string | null
}

type OpenClawLatestReleaseApi = {
  data?: {
    tagName: string | null
    version: string | null
    name: string | null
    url: string
    publishedAt: string | null
  }
  error?: string
}

const USER_AVATAR_MAX_DIMENSION = 256
const USER_AVATAR_MAX_DATA_URL_LENGTH = 1_500_000
const OPENCLAW_RELEASES_URL = 'https://github.com/openclaw/openclaw/releases'

function normalizeVersion(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = value.trim().replace(/^v/i, '')
  return normalized.length > 0 ? normalized : null
}

function parseVersionParts(value: string | null | undefined): number[] | null {
  const normalized = normalizeVersion(value)
  if (!normalized) return null
  const parts = normalized.match(/\d+/g)?.map((part) => Number(part))
  if (!parts || parts.length === 0 || parts.some((part) => !Number.isFinite(part))) return null
  return parts
}

function isVersionUpdateAvailable(currentVersion: string | null | undefined, latestVersion: string | null | undefined): boolean {
  const current = normalizeVersion(currentVersion)
  const latest = normalizeVersion(latestVersion)
  if (!current || !latest) return false

  const currentParts = parseVersionParts(current)
  const latestParts = parseVersionParts(latest)

  if (!currentParts || !latestParts) {
    return current !== latest
  }

  const length = Math.max(currentParts.length, latestParts.length)
  for (let i = 0; i < length; i += 1) {
    const left = currentParts[i] ?? 0
    const right = latestParts[i] ?? 0
    if (left === right) continue
    return left < right
  }

  return false
}

declare global {
  interface Window {
    clawcontrolDesktop?: {
      pickDirectory: (defaultPath?: string) => Promise<string | null>
      restartServer?: () => Promise<{ ok: boolean; message: string }>
      checkForUpdates?: () => Promise<DesktopUpdateInfo>
      getWhatsNew?: () => Promise<{
        version: string
        title: string
        publishedAt: string | null
        highlights: string[]
        sections?: Array<{
          title: string
          items: string[]
        }>
        releaseUrl: string
      } | null>
      ackWhatsNew?: (version: string) => Promise<{ ok: boolean }>
      openExternalUrl?: (url: string) => Promise<{ ok: boolean; message?: string }>
    }
  }
}

export default function SettingsPage() {
  const { mode, setMode } = useLayout()
  const {
    theme,
    setTheme,
    skipTypedConfirm,
    setSkipTypedConfirm,
    userAvatarDataUrl,
    setUserAvatarDataUrl,
  } = useSettings()

  // Settings config state
  const [settingsConfig, setSettingsConfig] = useState<SettingsConfigResponse | null>(null)
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [workspacePath, setWorkspacePath] = useState('')
  const [gatewayHttpUrl, setGatewayHttpUrl] = useState('')
  const [remoteAccessMode, setRemoteAccessMode] = useState<RemoteAccessMode>('local_only')
  const [pickerAvailable, setPickerAvailable] = useState(false)
  const [restartAvailable, setRestartAvailable] = useState(false)
  const [updatesBridgeAvailable, setUpdatesBridgeAvailable] = useState(false)
  const [pickingWorkspace, setPickingWorkspace] = useState(false)
  const [testingGateway, setTestingGateway] = useState(false)
  const [gatewayConnectionState, setGatewayConnectionState] = useState<GatewayConnectionState>('idle')
  const [gatewayConnectionMessage, setGatewayConnectionMessage] = useState<string | null>(null)
  const [tailscaleReadiness, setTailscaleReadiness] = useState<TailscaleReadinessResponse | null>(null)
  const [tailscaleReadinessLoading, setTailscaleReadinessLoading] = useState(false)
  const [tailscaleReadinessError, setTailscaleReadinessError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [restartingServer, setRestartingServer] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [updatesLoading, setUpdatesLoading] = useState(false)
  const [updatesError, setUpdatesError] = useState<string | null>(null)
  const [openingRelease, setOpeningRelease] = useState(false)
  const [desktopUpdateInfo, setDesktopUpdateInfo] = useState<DesktopUpdateInfo | null>(null)
  const [openClawUpdatesLoading, setOpenClawUpdatesLoading] = useState(false)
  const [openClawUpdatesError, setOpenClawUpdatesError] = useState<string | null>(null)
  const [openingOpenClawRelease, setOpeningOpenClawRelease] = useState(false)
  const [openClawUpdateInfo, setOpenClawUpdateInfo] = useState<OpenClawUpdateInfo | null>(null)

  // OpenClaw auto-discovery state
  const [discoverData, setDiscoverData] = useState<OpenClawDiscoverResponse | null>(null)
  const [discoverLoading, setDiscoverLoading] = useState(true)
  const [discoverError, setDiscoverError] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncSuccessAt, setSyncSuccessAt] = useState<string | null>(null)
  const { status: syncStatus, syncing, triggerSync } = useSyncStatus({ polling: false })

  // Load settings config
  useEffect(() => {
    loadSettingsConfig()
    loadDiscover()
    void handleCheckOpenClawUpdates(true)

    if (typeof window !== 'undefined') {
      setPickerAvailable(typeof window.clawcontrolDesktop?.pickDirectory === 'function')
      setRestartAvailable(typeof window.clawcontrolDesktop?.restartServer === 'function')
      const canCheckUpdates = typeof window.clawcontrolDesktop?.checkForUpdates === 'function'
      setUpdatesBridgeAvailable(canCheckUpdates)
      if (canCheckUpdates) {
        void handleCheckForUpdates(true)
      }
    }
  }, [])

  useEffect(() => {
    if (mode !== 'auto') {
      setMode('auto')
    }
  }, [mode, setMode])

  useEffect(() => {
    if (theme !== 'dark') {
      setTheme('dark')
    }
  }, [theme, setTheme])

  async function loadSettingsConfig() {
    setSettingsLoading(true)
    setSettingsError(null)
    try {
      const res = await configApi.getSettings()
      setSettingsConfig(res.data)
      setWorkspacePath(res.data.settings.workspacePath || '')
      setGatewayHttpUrl(
        res.data.settings.gatewayHttpUrl
          || res.data.resolved?.gatewayHttpUrl
          || 'http://127.0.0.1:18789'
      )
      setRemoteAccessMode(res.data.settings.remoteAccessMode || 'local_only')
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Failed to load settings')
    } finally {
      setSettingsLoading(false)
    }
  }

  async function loadDiscover() {
    setDiscoverLoading(true)
    setDiscoverError(null)

    try {
      const res = await fetch('/api/openclaw/discover', { cache: 'no-store' })
      const data = (await res.json().catch(() => null)) as OpenClawDiscoverResponse | null

      if (!res.ok && res.status !== 404) {
        throw new Error(data && 'message' in data ? data.message : 'Failed to discover OpenClaw')
      }

      setDiscoverData(data)
      if (data && data.status !== 'not_found') {
        applyGatewayTestResult({
          gatewayUrl: data.gatewayUrl,
          tokenProvided: data.hasToken,
          reachable: data.status === 'connected',
          state: data.status === 'connected'
            ? 'reachable'
            : data.status === 'auth_required'
              ? 'auth_required'
              : 'unreachable',
          probe: data.probe
            ? {
                ok: data.status === 'connected',
                state: data.status === 'connected'
                  ? 'reachable'
                  : data.status === 'auth_required'
                    ? 'auth_required'
                    : 'unreachable',
                url: `${data.gatewayUrl.replace(/\/+$/, '')}/health`,
                latencyMs: data.probe.latencyMs,
                ...(data.probe.statusCode !== undefined ? { statusCode: data.probe.statusCode } : {}),
                ...(data.probe.error ? { error: data.probe.error } : {}),
              }
            : undefined,
        })
      }
    } catch (err) {
      setDiscoverError(err instanceof Error ? err.message : 'Failed to discover OpenClaw')
      setDiscoverData(null)
    } finally {
      setDiscoverLoading(false)
    }
  }

  async function handleCheckForUpdates(silent = false) {
    if (typeof window === 'undefined' || typeof window.clawcontrolDesktop?.checkForUpdates !== 'function') {
      if (!silent) {
        setUpdatesError('Update checks are only available in the desktop app.')
      }
      return
    }

    setUpdatesLoading(true)
    if (!silent) {
      setUpdatesError(null)
    }

    try {
      const info = await window.clawcontrolDesktop.checkForUpdates()
      setDesktopUpdateInfo(info)
      setUpdatesError(info.error ?? null)
    } catch (err) {
      setUpdatesError(err instanceof Error ? err.message : 'Failed to check for updates')
    } finally {
      setUpdatesLoading(false)
    }
  }

  async function handleCheckOpenClawUpdates(silent = false) {
    setOpenClawUpdatesLoading(true)
    if (!silent) {
      setOpenClawUpdatesError(null)
    }

    try {
      const res = await fetch('/api/openclaw/releases/latest', { cache: 'no-store' })
      const payload = (await res.json().catch(() => null)) as OpenClawLatestReleaseApi | null

      if (!res.ok || !payload?.data) {
        throw new Error(payload?.error ?? 'Failed to check OpenClaw updates')
      }

      setOpenClawUpdateInfo({
        latestVersion: payload.data.version,
        releaseUrl: payload.data.url || OPENCLAW_RELEASES_URL,
        releaseName: payload.data.name,
        publishedAt: payload.data.publishedAt,
      })
      setOpenClawUpdatesError(null)
    } catch (err) {
      if (!silent) {
        setOpenClawUpdatesError(err instanceof Error ? err.message : 'Failed to check OpenClaw updates')
      }
    } finally {
      setOpenClawUpdatesLoading(false)
    }
  }

  async function openExternalUrl(url: string): Promise<void> {
    if (typeof window === 'undefined') return

    if (typeof window.clawcontrolDesktop?.openExternalUrl === 'function') {
      const result = await window.clawcontrolDesktop.openExternalUrl(url)
      if (!result.ok) {
        throw new Error(result.message ?? 'Failed to open external URL')
      }
      return
    }

    window.open(url, '_blank', 'noopener,noreferrer')
  }

  async function handleOpenReleasePage() {
    const releaseUrl = desktopUpdateInfo?.releaseUrl
    if (!releaseUrl) return

    setOpeningRelease(true)
    setUpdatesError(null)

    try {
      await openExternalUrl(releaseUrl)
    } catch (err) {
      setUpdatesError(err instanceof Error ? err.message : 'Failed to open release page')
    } finally {
      setOpeningRelease(false)
    }
  }

  async function handleOpenOpenClawReleasePage() {
    const releaseUrl = openClawUpdateInfo?.releaseUrl || OPENCLAW_RELEASES_URL

    setOpeningOpenClawRelease(true)
    setOpenClawUpdatesError(null)

    try {
      await openExternalUrl(releaseUrl)
    } catch (err) {
      setOpenClawUpdatesError(err instanceof Error ? err.message : 'Failed to open OpenClaw release page')
    } finally {
      setOpeningOpenClawRelease(false)
    }
  }

  async function handleSaveSettings() {
    const workspaceChanged = Boolean(
      settingsConfig
      && workspacePath !== (settingsConfig.settings.workspacePath || '')
    )
    setSaving(true)
    setRestartingServer(false)
    setSaveSuccess(false)
    setSettingsError(null)
    try {
      const res = await configApi.updateSettings({
        remoteAccessMode,
        workspacePath: workspacePath || null,
        gatewayHttpUrl: gatewayHttpUrl || null,
      })
      setSettingsConfig(res.data)

      if (workspaceChanged && typeof window !== 'undefined') {
        const restartFn = window.clawcontrolDesktop?.restartServer
        if (typeof restartFn === 'function') {
          setRestartingServer(true)
          const restartResult = await restartFn()
          if (restartResult?.ok) {
            await loadSettingsConfig()
          } else {
            setSettingsError(
              restartResult?.message || 'Configuration saved, but automatic restart failed. Restart manually.'
            )
          }
          setRestartingServer(false)
        }
      }

      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setRestartingServer(false)
      setSaving(false)
    }
  }

  async function handlePickWorkspace() {
    if (typeof window === 'undefined' || typeof window.clawcontrolDesktop?.pickDirectory !== 'function') {
      setSettingsError('Directory picker is only available in the desktop app.')
      return
    }

    setPickingWorkspace(true)
    setSettingsError(null)
    try {
      const selected = await window.clawcontrolDesktop.pickDirectory(workspacePath || undefined)
      if (selected) {
        setWorkspacePath(selected)
      }
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Failed to open directory picker')
    } finally {
      setPickingWorkspace(false)
    }
  }

  function applyGatewayTestResult(result: GatewayTestResponse) {
    if (result.state === 'reachable') {
      setGatewayConnectionState('connected')
      setGatewayConnectionMessage('Gateway reachable')
      return
    }

    if (result.state === 'auth_required') {
      setGatewayConnectionState('auth_required')
      setGatewayConnectionMessage('Gateway reachable, authentication required')
      return
    }

    setGatewayConnectionState('offline')
    setGatewayConnectionMessage(
      result.probe?.error
        ? `Gateway unreachable: ${result.probe.error}`
        : 'Gateway unreachable'
    )
  }

  async function handleTestConnection() {
    setTestingGateway(true)
    setGatewayConnectionState('testing')
    setGatewayConnectionMessage(null)

    try {
      const res = await configApi.testGateway({
        gatewayHttpUrl: gatewayHttpUrl || null,
        withRetry: true,
      })
      applyGatewayTestResult(res.data)
    } catch (err) {
      setGatewayConnectionState('offline')
      setGatewayConnectionMessage(err instanceof Error ? err.message : 'Failed to test gateway')
    } finally {
      setTestingGateway(false)
    }
  }

  async function handleRunTailscaleReadiness() {
    setTailscaleReadinessLoading(true)
    setTailscaleReadinessError(null)

    try {
      const res = await configApi.getTailscaleReadiness()
      setTailscaleReadiness(res.data)
    } catch (err) {
      setTailscaleReadinessError(err instanceof Error ? err.message : 'Failed to run tailscale readiness checks')
    } finally {
      setTailscaleReadinessLoading(false)
    }
  }

  function readinessStateClass(state: 'ok' | 'warning' | 'error' | 'unknown') {
    if (state === 'ok') return 'text-status-success'
    if (state === 'warning') return 'text-status-warning'
    if (state === 'error') return 'text-status-danger'
    return 'text-fg-3'
  }

  function readinessStateLabel(state: 'ok' | 'warning' | 'error' | 'unknown') {
    if (state === 'ok') return 'OK'
    if (state === 'warning') return 'Warning'
    if (state === 'error') return 'Error'
    return 'Unknown'
  }

  async function handleManualSync() {
    setSyncError(null)
    const ok = await triggerSync('manual')

    if (!ok) {
      setSyncError('Failed to sync with OpenClaw. Check gateway and config.')
      return
    }

    setSyncSuccessAt(new Date().toISOString())
    await loadDiscover()
  }

  const hasSettingsChanges = Boolean(
    settingsConfig && (
      workspacePath !== (settingsConfig.settings.workspacePath || '')
      || gatewayHttpUrl !== (settingsConfig.settings.gatewayHttpUrl || settingsConfig.resolved?.gatewayHttpUrl || '')
      || remoteAccessMode !== (settingsConfig.settings.remoteAccessMode || 'local_only')
    )
  )
  const discovered = discoverData && discoverData.status !== 'not_found' ? discoverData : null
  const notFound = discoverData && discoverData.status === 'not_found' ? discoverData : null
  const lastSyncAt = syncStatus?.lastSync?.timestamp ?? null
  const openClawInstalledVersion = settingsConfig?.runtime.cli.cliVersion ?? null
  const openClawLatestVersion = openClawUpdateInfo?.latestVersion ?? null
  const openClawCliAvailable = Boolean(settingsConfig?.runtime.cli.cliAvailable)
  const openClawUpdateAvailable = openClawCliAvailable && isVersionUpdateAvailable(openClawInstalledVersion, openClawLatestVersion)

  async function handleAvatarFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setAvatarError(null)
    setAvatarBusy(true)
    try {
      if (!file.type.startsWith('image/')) {
        throw new Error('Please select an image file')
      }

      const dataUrl = await fileToDataUrl(file)
      const resizedDataUrl = await resizeImageDataUrl(dataUrl, USER_AVATAR_MAX_DIMENSION)
      if (resizedDataUrl.length > USER_AVATAR_MAX_DATA_URL_LENGTH) {
        throw new Error('Image is too large. Please pick a smaller image.')
      }

      setUserAvatarDataUrl(resizedDataUrl)
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Failed to process image')
    } finally {
      setAvatarBusy(false)
    }
  }

  return (
    <div className="w-full space-y-8">
      <div>
        <h1 className="text-lg font-semibold text-fg-0">Settings</h1>
        <p className="text-sm text-fg-2 mt-1">Configure clawcontrol preferences</p>
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium text-fg-0">Profile</h2>
          <p className="text-xs text-fg-2 mt-0.5">
            Choose the avatar used for your operator messages in Console chat
          </p>
        </div>

        <div className="p-4 rounded-[var(--radius-lg)] bg-bg-2 border border-bd-0 space-y-4">
          <div className="flex items-center gap-3">
            <UserAvatar avatarDataUrl={userAvatarDataUrl} size="lg" />
            <div>
              <p className="text-sm text-fg-1">Chat avatar</p>
              <p className="text-xs text-fg-3 mt-0.5">Visible on your user-side chat bubbles</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label
              className={cn(
                buttonLikeClass({ variant: 'secondary', size: 'md', className: 'cursor-pointer' }),
                avatarBusy
                  ? 'text-fg-3 cursor-not-allowed'
                  : null
              )}
            >
              <input
                type="file"
                accept="image/*"
                onChange={handleAvatarFileChange}
                disabled={avatarBusy}
                className="sr-only"
              />
              {avatarBusy ? <LoadingSpinner size="md" /> : <Upload className="w-4 h-4" />}
              {avatarBusy ? 'Processing...' : 'Upload Image'}
            </label>

            <Button
              type="button"
              onClick={() => setUserAvatarDataUrl(null)}
              disabled={!userAvatarDataUrl || avatarBusy}
              variant="secondary"
              size="md"
              className={cn(!(userAvatarDataUrl && !avatarBusy) && 'text-fg-3')}
            >
              <Trash2 className="w-4 h-4" />
              Reset
            </Button>
          </div>

          {avatarError && (
            <div className="flex items-center gap-2 p-2 rounded bg-status-danger/10 text-status-danger text-xs">
              <AlertCircle className="w-3 h-3 shrink-0" />
              <span>{avatarError}</span>
            </div>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium text-fg-0">App Updates</h2>
          <p className="text-xs text-fg-2 mt-0.5">
            Check latest desktop and OpenClaw release status.
          </p>
        </div>

        <div className="p-4 rounded-[var(--radius-lg)] bg-bg-2 border border-bd-0">
          <div className="grid gap-3 xl:grid-cols-2">
            <div className="rounded-[var(--radius-md)] border border-bd-0 bg-bg-1 p-3 space-y-3">
              <div className="text-[11px] uppercase tracking-[0.12em] text-fg-2">ClawControl App</div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-fg-3">Installed:</span>
                  <span className="font-mono text-fg-1">{desktopUpdateInfo?.currentVersion ?? 'unknown'}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-fg-3">Latest:</span>
                  <span className="font-mono text-fg-1">{desktopUpdateInfo?.latestVersion ?? 'unknown'}</span>
                </div>
                <div className="text-xs">
                  <span
                    className={cn(
                      'font-medium',
                      desktopUpdateInfo?.updateAvailable
                        ? 'text-status-warning'
                        : desktopUpdateInfo
                          ? 'text-status-success'
                          : 'text-fg-3'
                    )}
                  >
                    {desktopUpdateInfo?.updateAvailable
                      ? 'Update available'
                      : desktopUpdateInfo
                        ? 'You are up to date'
                        : 'Not checked yet'}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  onClick={() => void handleCheckForUpdates(false)}
                  disabled={updatesLoading || !updatesBridgeAvailable}
                  variant="secondary"
                  size="sm"
                  className={cn((updatesLoading || !updatesBridgeAvailable) && 'text-fg-3')}
                >
                  {updatesLoading ? <LoadingSpinner size="sm" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  {updatesLoading ? 'Checking...' : 'Check for Updates'}
                </Button>

                <Button
                  onClick={() => void handleOpenReleasePage()}
                  disabled={!desktopUpdateInfo?.releaseUrl || openingRelease || !updatesBridgeAvailable}
                  variant="secondary"
                  size="sm"
                  className={cn((!desktopUpdateInfo?.releaseUrl || openingRelease || !updatesBridgeAvailable) && 'text-fg-3')}
                >
                  {openingRelease ? <LoadingSpinner size="sm" /> : <ArrowUpRight className="w-3.5 h-3.5" />}
                  Open Release
                </Button>
              </div>

              {!updatesBridgeAvailable && (
                <p className="text-xs text-fg-3">
                  Update checks are available in the desktop app only.
                </p>
              )}

              {updatesError && (
                <div className="flex items-center gap-2 p-2 rounded bg-status-danger/10 text-status-danger text-xs">
                  <AlertCircle className="w-3 h-3 shrink-0" />
                  <span>{updatesError}</span>
                </div>
              )}
            </div>

            <div className="rounded-[var(--radius-md)] border border-bd-0 bg-bg-1 p-3 space-y-3">
              <div className="text-[11px] uppercase tracking-[0.12em] text-fg-2">OpenClaw CLI</div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-fg-3">Installed:</span>
                  <span className="font-mono text-fg-1">
                    {openClawCliAvailable ? (openClawInstalledVersion ?? 'unknown') : 'unavailable'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-fg-3">Latest:</span>
                  <span className="font-mono text-fg-1">{openClawLatestVersion ?? 'unknown'}</span>
                </div>
                <div className="text-xs">
                  <span
                    className={cn(
                      'font-medium',
                      !openClawCliAvailable
                        ? 'text-status-danger'
                        : openClawUpdateAvailable
                          ? 'text-status-warning'
                          : openClawUpdateInfo
                            ? 'text-status-success'
                            : 'text-fg-3'
                    )}
                  >
                    {!openClawCliAvailable
                      ? 'OpenClaw CLI unavailable'
                      : openClawUpdateAvailable
                        ? 'Update available'
                        : openClawUpdateInfo
                          ? 'You are up to date'
                          : 'Not checked yet'}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  onClick={() => void handleCheckOpenClawUpdates(false)}
                  disabled={openClawUpdatesLoading}
                  variant="secondary"
                  size="sm"
                  className={cn(openClawUpdatesLoading && 'text-fg-3')}
                >
                  {openClawUpdatesLoading ? <LoadingSpinner size="sm" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  {openClawUpdatesLoading ? 'Checking...' : 'Check for Updates'}
                </Button>

                <Button
                  onClick={() => void handleOpenOpenClawReleasePage()}
                  disabled={openingOpenClawRelease}
                  variant="secondary"
                  size="sm"
                  className={cn(openingOpenClawRelease && 'text-fg-3')}
                >
                  {openingOpenClawRelease ? <LoadingSpinner size="sm" /> : <ArrowUpRight className="w-3.5 h-3.5" />}
                  Open Releases
                </Button>
              </div>

              {openClawUpdateInfo?.releaseName && (
                <p className="text-[11px] text-fg-3">
                  Latest release: {openClawUpdateInfo.releaseName}
                </p>
              )}

              {openClawUpdatesError && (
                <div className="flex items-center gap-2 p-2 rounded bg-status-danger/10 text-status-danger text-xs">
                  <AlertCircle className="w-3 h-3 shrink-0" />
                  <span>{openClawUpdatesError}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Workspace Configuration Section */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium text-fg-0">Workspace</h2>
          <p className="text-xs text-fg-2 mt-0.5">
            Configure the OpenClaw workspace directory (agents/, skills/, etc.)
          </p>
        </div>

        <div className="p-4 rounded-[var(--radius-lg)] bg-bg-2 border border-bd-0 space-y-4">
          {settingsLoading ? (
            <div className="flex items-center gap-2 text-fg-2">
              <InlineLoading label="Loading settings..." size="md" />
            </div>
          ) : settingsError ? (
            <div className="flex items-center gap-2 text-status-danger">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">{settingsError}</span>
              <button
                onClick={loadSettingsConfig}
                className="ml-auto p-1 hover:bg-bg-3 rounded"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-fg-1">
                  Remote Access Mode
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    onClick={() => setRemoteAccessMode('local_only')}
                    disabled={saving}
                    className={cn(
                      'rounded-[var(--radius-md)] border px-3 py-2 text-left transition-colors',
                      saving && 'cursor-not-allowed opacity-80',
                      remoteAccessMode === 'local_only'
                        ? 'border-status-info/70 bg-status-info/10 text-fg-0'
                        : 'border-bd-0 bg-bg-1 text-fg-2 hover:bg-bg-3'
                    )}
                  >
                    <p className="text-sm font-medium">Local only (recommended)</p>
                    <p className="mt-1 text-xs text-fg-3">
                      Use this machine directly at <code>http://127.0.0.1:3000</code>.
                    </p>
                  </button>

                  <button
                    onClick={() => setRemoteAccessMode('tailscale_tunnel')}
                    disabled={saving}
                    className={cn(
                      'rounded-[var(--radius-md)] border px-3 py-2 text-left transition-colors',
                      saving && 'cursor-not-allowed opacity-80',
                      remoteAccessMode === 'tailscale_tunnel'
                        ? 'border-status-info/70 bg-status-info/10 text-fg-0'
                        : 'border-bd-0 bg-bg-1 text-fg-2 hover:bg-bg-3'
                    )}
                  >
                    <p className="text-sm font-medium">Tailscale tunnel (advanced)</p>
                    <p className="mt-1 text-xs text-fg-3">
                      Keep local bind and use SSH port forwarding over your tailnet.
                    </p>
                  </button>
                </div>

                {remoteAccessMode === 'tailscale_tunnel' ? (
                  <div className="rounded-[var(--radius-md)] border border-status-warning/40 bg-status-warning/10 px-3 py-3 text-xs text-fg-1 space-y-2">
                    <p className="font-medium text-status-warning">
                      Tunnel mode keeps ClawControl local-only.
                    </p>
                    <p>Host machine remains bound to <code>127.0.0.1:3000</code>.</p>
                    <p>From a remote machine on your tailnet, run:</p>
                    <pre className="overflow-x-auto rounded bg-bg-1 p-2 text-[11px] text-fg-2">
ssh -L 3000:127.0.0.1:3000 {'<user>@<host-tailnet-name>'}
                    </pre>
                    <p>Then open <code>http://127.0.0.1:3000</code> on the remote machine.</p>
                    <p className="text-status-danger">
                      Never use <code>tailscale serve</code> or expose ClawControl directly.
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-fg-3">
                    Local-only mode never exposes ClawControl to LAN or internet interfaces.
                  </p>
                )}

                <div className="rounded-[var(--radius-md)] border border-bd-0 bg-bg-1 p-3 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-fg-1">Tailscale Readiness Check</p>
                      <p className="text-xs text-fg-3">
                        Runs security and usability checks: listener bindings, gateway policy, tailscale status, serve exposure, and SSH availability.
                      </p>
                    </div>
                    <Button
                      onClick={handleRunTailscaleReadiness}
                      disabled={tailscaleReadinessLoading}
                      variant="secondary"
                      size="sm"
                      className={cn('shrink-0', tailscaleReadinessLoading && 'text-fg-3')}
                    >
                      {tailscaleReadinessLoading ? (
                        <LoadingSpinner size="sm" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                      {tailscaleReadinessLoading ? 'Running...' : 'Run Checks'}
                    </Button>
                  </div>

                  {tailscaleReadinessError && (
                    <div className="flex items-center gap-2 p-2 rounded bg-status-danger/10 text-status-danger text-xs">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{tailscaleReadinessError}</span>
                    </div>
                  )}

                  {tailscaleReadiness && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-fg-2">Overall readiness</span>
                        <span className={cn('font-medium', readinessStateClass(tailscaleReadiness.summary.state))}>
                          {readinessStateLabel(tailscaleReadiness.summary.state)}
                          {' '}
                          ({tailscaleReadiness.summary.ok} ok / {tailscaleReadiness.summary.warning} warning / {tailscaleReadiness.summary.error} error / {tailscaleReadiness.summary.unknown} unknown)
                        </span>
                      </div>

                      <div className="space-y-2">
                        {tailscaleReadiness.checks.map((check) => (
                          <div key={check.id} className="rounded border border-bd-0 bg-bg-2 p-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs text-fg-1">{check.title}</span>
                              <span className={cn('text-[11px] font-medium uppercase', readinessStateClass(check.state))}>
                                {readinessStateLabel(check.state)}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-fg-2">{check.message}</p>
                            {check.detail && (
                              <p className="mt-1 text-[11px] text-fg-3 font-mono break-all">{check.detail}</p>
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="pt-2 border-t border-bd-0 space-y-1">
                        <p className="text-xs text-fg-2">
                          Suggested host: <span className="font-mono">{tailscaleReadiness.context.suggestedHost}</span>
                        </p>
                        <pre className="overflow-x-auto rounded bg-bg-2 p-2 text-[11px] text-fg-2">
{tailscaleReadiness.commands.clawcontrolTunnel}
                        </pre>
                        <pre className="overflow-x-auto rounded bg-bg-2 p-2 text-[11px] text-fg-2">
{tailscaleReadiness.commands.gatewayTunnel}
                        </pre>
                        <p className="text-[11px] text-fg-3">
                          Last run: {new Date(tailscaleReadiness.generatedAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-fg-1">
                  Gateway URL
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={gatewayHttpUrl}
                    onChange={(e) => setGatewayHttpUrl(e.target.value)}
                    placeholder="http://127.0.0.1:18789"
                    className="flex-1 px-3 py-2 text-sm bg-bg-1 border border-bd-0 rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-3 focus:outline-none focus:border-status-info/50"
                  />
                  <button
                    onClick={handleTestConnection}
                    disabled={testingGateway || saving}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-[var(--radius-md)] transition-colors',
                      !testingGateway && !saving
                        ? 'bg-bg-3 text-fg-1 hover:bg-bd-1'
                        : 'bg-bg-3 text-fg-3 cursor-not-allowed'
                    )}
                  >
                    {testingGateway ? (
                      <LoadingSpinner size="md" />
                    ) : (
                      <RefreshCw className="w-4 h-4" />
                    )}
                    {testingGateway ? 'Testing...' : 'Test Connection'}
                  </button>
                </div>

                <div className="flex items-center justify-between text-xs text-fg-2">
                  <span>Connection status:</span>
                  <span
                    className={cn(
                      'font-medium',
                      gatewayConnectionState === 'connected'
                        ? 'text-status-success'
                        : gatewayConnectionState === 'auth_required'
                          ? 'text-status-warning'
                          : gatewayConnectionState === 'offline'
                            ? 'text-status-danger'
                            : 'text-fg-3'
                    )}
                  >
                    {gatewayConnectionState === 'testing'
                      ? 'Testing'
                      : gatewayConnectionState === 'connected'
                        ? 'Connected'
                        : gatewayConnectionState === 'auth_required'
                          ? 'Auth required'
                          : gatewayConnectionState === 'offline'
                            ? 'Offline'
                            : 'Not tested'}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs text-fg-2">
                  <span>CLI status:</span>
                  <span
                    className={cn(
                      'font-medium',
                      settingsConfig?.runtime.cli.cliAvailable
                        ? 'text-status-success'
                        : 'text-status-danger'
                    )}
                  >
                    {settingsConfig?.runtime.cli.cliAvailable
                      ? `Available (${settingsConfig.runtime.cli.cliVersion ?? 'unknown'})`
                      : 'Unavailable'}
                  </span>
                </div>

                <div className="text-xs text-fg-3 font-mono break-all">
                  Binary: {settingsConfig?.runtime.cli.resolvedCliBin ?? 'unknown'}
                </div>

                {gatewayConnectionMessage && (
                  <p className="text-xs text-fg-3">{gatewayConnectionMessage}</p>
                )}

                {settingsConfig?.runtime.cli.cliError && (
                  <p className="text-xs text-status-danger">{settingsConfig.runtime.cli.cliError}</p>
                )}
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-fg-1">
                  <FolderOpen className="w-4 h-4 text-fg-2" />
                  Workspace Path
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={workspacePath}
                    onChange={(e) => setWorkspacePath(e.target.value)}
                    placeholder="/path/to/your/workspace"
                    className="flex-1 px-3 py-2 text-sm bg-bg-1 border border-bd-0 rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-3 focus:outline-none focus:border-status-info/50"
                  />
                  {pickerAvailable && (
                    <Button
                      onClick={handlePickWorkspace}
                      disabled={pickingWorkspace || saving}
                      variant="secondary"
                      size="md"
                      className={cn((pickingWorkspace || saving) && 'text-fg-3')}
                    >
                      {pickingWorkspace ? (
                        <LoadingSpinner size="md" />
                      ) : (
                        <FolderOpen className="w-4 h-4" />
                      )}
                      Browse
                    </Button>
                  )}
                  <Button
                    onClick={handleSaveSettings}
                    disabled={!hasSettingsChanges || saving}
                    variant={hasSettingsChanges && !saving ? 'primary' : 'secondary'}
                    size="md"
                    className={cn(!(hasSettingsChanges && !saving) && 'text-fg-3')}
                  >
                    {saving ? (
                      <LoadingSpinner size="md" />
                    ) : saveSuccess ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    {saving ? (restartingServer ? 'Restarting...' : 'Saving...') : saveSuccess ? 'Saved' : 'Save'}
                  </Button>
                </div>
              </div>

              {/* Current resolved workspace info */}
              {settingsConfig?.resolved?.workspacePath && (
                <div className="pt-3 border-t border-bd-0 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-fg-3">Resolved workspace:</span>
                    <span className="font-mono text-fg-2">{settingsConfig.resolved.workspacePath}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-fg-3">Settings file:</span>
                    <span className="font-mono text-fg-2 truncate max-w-[70%]">{settingsConfig.settingsPath}</span>
                  </div>
                </div>
              )}

              {settingsConfig && !settingsConfig.workspaceValidation.ok && (
                <div className="flex items-center gap-2 p-2 rounded bg-status-danger/10 text-status-danger text-xs">
                  <AlertCircle className="w-3 h-3 shrink-0" />
                  <span>
                    {settingsConfig.workspaceValidation.issues.find((issue) => issue.level === 'error')?.message
                      ?? 'Workspace validation failed'}
                  </span>
                </div>
              )}

              {/* Help text */}
              <p className="text-xs text-fg-3 pt-2">
                Configure access mode, gateway URL, and workspace directory. Gateway/access mode changes apply immediately after save; workspace changes may require restart.
                {restartAvailable
                  ? ' Changes are applied with an automatic server restart.'
                  : ' Changes require a server restart.'}
              </p>
            </>
          )}
        </div>
      </section>

      {/* OpenClaw Auto-Discovery Section */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium text-fg-0">OpenClaw</h2>
          <p className="text-xs text-fg-2 mt-0.5">
            Auto-detect gateway URL and agents from <span className="font-mono">~/.openclaw</span> (or <span className="font-mono">~/.OpenClaw</span>), <span className="font-mono">~/.moltbot</span>, and <span className="font-mono">~/.clawdbot</span>
          </p>
        </div>

        <div className="p-4 rounded-[var(--radius-lg)] bg-bg-2 border border-bd-0 space-y-4">
          {discoverLoading ? (
            <div className="flex items-center gap-2 text-fg-2">
              <InlineLoading label="Scanning local OpenClaw config..." size="md" />
            </div>
          ) : discoverError ? (
            <div className="flex items-center gap-2 text-status-danger">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">{discoverError}</span>
              <button
                onClick={loadDiscover}
                className="ml-auto p-1 hover:bg-bg-3 rounded"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'w-2 h-2 rounded-full',
                      discoverData?.status === 'connected'
                        ? 'bg-status-success'
                        : discoverData?.status === 'auth_required'
                          ? 'bg-status-warning'
                        : discoverData?.status === 'offline'
                          ? 'bg-status-danger'
                        : 'bg-status-warning'
                    )}
                  />
                  <span className="text-sm text-fg-1">
                    {discoverData?.status === 'connected'
                      ? 'Connected'
                      : discoverData?.status === 'auth_required'
                        ? 'Auth Required'
                      : discoverData?.status === 'offline'
                        ? 'Offline'
                        : 'Not Found'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    onClick={loadDiscover}
                    variant="secondary"
                    size="sm"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Refresh
                  </Button>
                  <Button
                    onClick={handleManualSync}
                    disabled={syncing}
                    variant={syncing ? 'secondary' : 'primary'}
                    size="sm"
                    className={cn(syncing && 'text-fg-3')}
                  >
                    <RefreshCw className={cn('w-3.5 h-3.5', syncing && 'animate-spin')} />
                    {syncing ? 'Syncing...' : 'Sync Now'}
                  </Button>
                </div>
              </div>

              {discoverData?.status === 'not_found' ? (
                <div className="flex items-center gap-2 p-2 rounded bg-status-warning/10 text-status-warning text-xs">
                  <AlertCircle className="w-3 h-3 shrink-0" />
                  <span>{notFound?.message || 'OpenClaw config not found'}</span>
                </div>
              ) : (
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-fg-3">Last synced:</span>
                    <span className="text-fg-2">
                      {lastSyncAt ? formatRelativeTime(lastSyncAt) : 'Never'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-fg-3">Gateway URL:</span>
                    <span className="font-mono text-fg-2">{discovered?.gatewayUrl || '—'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-fg-3">Gateway WS URL:</span>
                    <span className="font-mono text-fg-2">{discovered?.gatewayWsUrl || '—'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-fg-3">Token detected:</span>
                    <span className="text-fg-2">{discovered?.hasToken ? 'Yes' : 'No'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-fg-3">Workspace:</span>
                    <span className="font-mono text-fg-2">{discovered?.workspacePath || '—'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-fg-3">Source:</span>
                    <span className="text-fg-2">{discovered?.source || '—'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-fg-3">Agents discovered:</span>
                    <span className="text-fg-2">{typeof discovered?.agentCount === 'number' ? discovered.agentCount : '—'}</span>
                  </div>

                  {discovered && discovered.agents.length > 0 && (
                    <div className="pt-2 border-t border-bd-0">
                      <p className="text-fg-3">Agents:</p>
                      <p className="text-fg-2 mt-1">
                        {discovered.agents
                          .slice(0, 8)
                          .map((a) => a.identity || a.id)
                          .filter(Boolean)
                          .join(', ')}
                        {discovered.agents.length > 8 ? '…' : ''}
                      </p>
                    </div>
                  )}

                  {syncError && (
                    <div className="flex items-center gap-2 p-2 rounded bg-status-danger/10 text-status-danger text-xs">
                      <AlertCircle className="w-3 h-3 shrink-0" />
                      <span>{syncError}</span>
                    </div>
                  )}

                  {syncSuccessAt && (
                    <div className="flex items-center gap-2 p-2 rounded bg-status-success/10 text-status-success text-xs">
                      <Check className="w-3 h-3 shrink-0" />
                      <span>Sync completed {formatRelativeTime(syncSuccessAt)}</span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* Power User Section */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium text-fg-0">Power User</h2>
          <p className="text-xs text-fg-2 mt-0.5">
            Settings for experienced users
          </p>
        </div>

        <div className="p-4 rounded-[var(--radius-lg)] bg-bg-2 border border-bd-0 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={cn(
                'p-2 rounded-[var(--radius-md)]',
                skipTypedConfirm ? 'bg-status-warning/10' : 'bg-bg-3'
              )}>
                <ShieldOff className={cn(
                  'w-4 h-4',
                  skipTypedConfirm ? 'text-status-warning' : 'text-fg-2'
                )} />
              </div>
              <div>
                <span className="text-sm font-medium text-fg-0">Skip Typed Confirmation</span>
                <p className="text-xs text-fg-2 mt-0.5">
                  Auto-confirm protected actions without typing &quot;CONFIRM&quot;
                </p>
              </div>
            </div>
            <SegmentedToggle
              value={skipTypedConfirm ? 'on' : 'off'}
              onChange={(next) => setSkipTypedConfirm(next === 'on')}
              tone="neutral"
              size="sm"
              ariaLabel="Skip typed confirmation"
              items={[
                { value: 'off', label: 'Off' },
                { value: 'on', label: 'On' },
              ]}
            />
          </div>

          {skipTypedConfirm && (
            <div className="flex items-center gap-2 p-2 rounded bg-status-warning/10 text-status-warning text-xs">
              <AlertCircle className="w-3 h-3 shrink-0" />
              <span>Protected actions will execute immediately without confirmation dialogs</span>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function formatRelativeTime(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value
  const diffMs = Date.now() - date.getTime()
  const diffSeconds = Math.max(0, Math.floor(diffMs / 1000))

  if (diffSeconds < 60) return 'just now'
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`
  return `${Math.floor(diffSeconds / 86400)}d ago`
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Could not read image'))
        return
      }
      resolve(reader.result)
    }
    reader.onerror = () => reject(new Error('Could not read image'))
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Invalid image'))
    image.src = src
  })
}

async function resizeImageDataUrl(dataUrl: string, maxDimension: number): Promise<string> {
  const image = await loadImage(dataUrl)
  const largest = Math.max(image.width, image.height)

  const scale = largest > maxDimension ? maxDimension / largest : 1
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to process image')
  ctx.drawImage(image, 0, 0, width, height)

  const webp = canvas.toDataURL('image/webp', 0.9)
  if (webp.startsWith('data:image/webp')) return webp
  return canvas.toDataURL('image/png')
}
