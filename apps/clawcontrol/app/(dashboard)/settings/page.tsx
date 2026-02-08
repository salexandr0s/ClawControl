'use client'

import { useState, useEffect, type ChangeEvent } from 'react'
import { useLayout } from '@/lib/layout-context'
import { useSettings } from '@/lib/settings-context'
import { useSyncStatus } from '@/lib/hooks/useSyncStatus'
import { configApi, type EnvConfigResponse } from '@/lib/http'
import { cn } from '@/lib/utils'
import { UserAvatar } from '@/components/ui/user-avatar'
import {
  Maximize2,
  Check,
  FolderOpen,
  AlertCircle,
  RefreshCw,
  Save,
  Loader2,
  ShieldOff,
  Upload,
  Trash2,
} from 'lucide-react'

type OpenClawDiscoverOk = {
  status: 'connected' | 'offline'
  gatewayUrl: string
  hasToken: boolean
  agentCount: number
  agents: Array<{ id: string; identity: string }>
}

type OpenClawDiscoverNotFound = {
  status: 'not_found'
  message: string
}

type OpenClawDiscoverResponse = OpenClawDiscoverOk | OpenClawDiscoverNotFound
const USER_AVATAR_MAX_DIMENSION = 256
const USER_AVATAR_MAX_DATA_URL_LENGTH = 1_500_000

declare global {
  interface Window {
    clawcontrolDesktop?: {
      pickDirectory: (defaultPath?: string) => Promise<string | null>
      restartServer?: () => Promise<{ ok: boolean; message: string }>
    }
  }
}

export default function SettingsPage() {
  const { mode, setMode, resolved } = useLayout()
  const {
    theme,
    setTheme,
    skipTypedConfirm,
    setSkipTypedConfirm,
    userAvatarDataUrl,
    setUserAvatarDataUrl,
  } = useSettings()

  // Environment config state
  const [envConfig, setEnvConfig] = useState<EnvConfigResponse | null>(null)
  const [envLoading, setEnvLoading] = useState(true)
  const [envError, setEnvError] = useState<string | null>(null)
  const [workspacePath, setWorkspacePath] = useState('')
  const [pickerAvailable, setPickerAvailable] = useState(false)
  const [restartAvailable, setRestartAvailable] = useState(false)
  const [pickingWorkspace, setPickingWorkspace] = useState(false)
  const [saving, setSaving] = useState(false)
  const [restartingServer, setRestartingServer] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarError, setAvatarError] = useState<string | null>(null)

  // OpenClaw auto-discovery state
  const [discoverData, setDiscoverData] = useState<OpenClawDiscoverResponse | null>(null)
  const [discoverLoading, setDiscoverLoading] = useState(true)
  const [discoverError, setDiscoverError] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncSuccessAt, setSyncSuccessAt] = useState<string | null>(null)
  const { status: syncStatus, syncing, triggerSync } = useSyncStatus({ polling: false })

  // Load environment config
  useEffect(() => {
    loadEnvConfig()
    loadDiscover()

    if (typeof window !== 'undefined') {
      setPickerAvailable(typeof window.clawcontrolDesktop?.pickDirectory === 'function')
      setRestartAvailable(typeof window.clawcontrolDesktop?.restartServer === 'function')
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

  async function loadEnvConfig() {
    setEnvLoading(true)
    setEnvError(null)
    try {
      const res = await configApi.getEnv()
      setEnvConfig(res.data)
      setWorkspacePath(res.data.config.OPENCLAW_WORKSPACE || '')
    } catch (err) {
      setEnvError(err instanceof Error ? err.message : 'Failed to load config')
    } finally {
      setEnvLoading(false)
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
    } catch (err) {
      setDiscoverError(err instanceof Error ? err.message : 'Failed to discover OpenClaw')
      setDiscoverData(null)
    } finally {
      setDiscoverLoading(false)
    }
  }

  async function handleSaveWorkspace() {
    const workspaceChanged = Boolean(hasWorkspaceChanges)
    setSaving(true)
    setRestartingServer(false)
    setSaveSuccess(false)
    setEnvError(null)
    try {
      const res = await configApi.updateEnv({
        OPENCLAW_WORKSPACE: workspacePath || null,
      })
      setEnvConfig(res.data)

      if (workspaceChanged && typeof window !== 'undefined') {
        const restartFn = window.clawcontrolDesktop?.restartServer
        if (typeof restartFn === 'function') {
          setRestartingServer(true)
          const restartResult = await restartFn()
          if (restartResult?.ok) {
            await loadEnvConfig()
          } else {
            setEnvError(
              restartResult?.message || 'Configuration saved, but automatic restart failed. Restart manually.'
            )
          }
          setRestartingServer(false)
        }
      }

      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err) {
      setEnvError(err instanceof Error ? err.message : 'Failed to save config')
    } finally {
      setRestartingServer(false)
      setSaving(false)
    }
  }

  async function handlePickWorkspace() {
    if (typeof window === 'undefined' || typeof window.clawcontrolDesktop?.pickDirectory !== 'function') {
      setEnvError('Directory picker is only available in the desktop app.')
      return
    }

    setPickingWorkspace(true)
    setEnvError(null)
    try {
      const selected = await window.clawcontrolDesktop.pickDirectory(workspacePath || undefined)
      if (selected) {
        setWorkspacePath(selected)
      }
    } catch (err) {
      setEnvError(err instanceof Error ? err.message : 'Failed to open directory picker')
    } finally {
      setPickingWorkspace(false)
    }
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

  const hasWorkspaceChanges = envConfig && workspacePath !== (envConfig.config.OPENCLAW_WORKSPACE || '')
  const discovered = discoverData && discoverData.status !== 'not_found' ? discoverData : null
  const notFound = discoverData && discoverData.status === 'not_found' ? discoverData : null
  const lastSyncAt = syncStatus?.lastSync?.timestamp ?? null

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
                'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-[var(--radius-md)] transition-colors cursor-pointer',
                avatarBusy
                  ? 'bg-bg-3 text-fg-3 cursor-not-allowed'
                  : 'bg-bg-3 text-fg-1 hover:bg-bd-1'
              )}
            >
              <input
                type="file"
                accept="image/*"
                onChange={handleAvatarFileChange}
                disabled={avatarBusy}
                className="sr-only"
              />
              {avatarBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {avatarBusy ? 'Processing...' : 'Upload Image'}
            </label>

            <button
              type="button"
              onClick={() => setUserAvatarDataUrl(null)}
              disabled={!userAvatarDataUrl || avatarBusy}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-[var(--radius-md)] transition-colors',
                userAvatarDataUrl && !avatarBusy
                  ? 'bg-bg-3 text-fg-1 hover:bg-bd-1'
                  : 'bg-bg-3 text-fg-3 cursor-not-allowed'
              )}
            >
              <Trash2 className="w-4 h-4" />
              Reset
            </button>
          </div>

          {avatarError && (
            <div className="flex items-center gap-2 p-2 rounded bg-status-danger/10 text-status-danger text-xs">
              <AlertCircle className="w-3 h-3 shrink-0" />
              <span>{avatarError}</span>
            </div>
          )}
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
          {envLoading ? (
            <div className="flex items-center gap-2 text-fg-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Loading configuration...</span>
            </div>
          ) : envError ? (
            <div className="flex items-center gap-2 text-status-danger">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">{envError}</span>
              <button
                onClick={loadEnvConfig}
                className="ml-auto p-1 hover:bg-bg-3 rounded"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <>
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
                    <button
                      onClick={handlePickWorkspace}
                      disabled={pickingWorkspace || saving}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-[var(--radius-md)] transition-colors',
                        !pickingWorkspace && !saving
                          ? 'bg-bg-3 text-fg-1 hover:bg-bd-1'
                          : 'bg-bg-3 text-fg-3 cursor-not-allowed'
                      )}
                    >
                      {pickingWorkspace ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <FolderOpen className="w-4 h-4" />
                      )}
                      Browse
                    </button>
                  )}
                  <button
                    onClick={handleSaveWorkspace}
                    disabled={!hasWorkspaceChanges || saving}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-[var(--radius-md)] transition-colors',
                      hasWorkspaceChanges && !saving
                        ? 'bg-status-info text-white hover:bg-status-info/90'
                        : 'bg-bg-3 text-fg-3 cursor-not-allowed'
                    )}
                  >
                    {saving ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : saveSuccess ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    {saving ? (restartingServer ? 'Restarting...' : 'Saving...') : saveSuccess ? 'Saved' : 'Save'}
                  </button>
                </div>
              </div>

              {/* Current active workspace info */}
              {envConfig?.activeWorkspace && (
                <div className="pt-3 border-t border-bd-0 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-fg-3">Active workspace:</span>
                    <span className="font-mono text-fg-2">{envConfig.activeWorkspace}</span>
                  </div>
                  {envConfig.requiresRestart && (
                    <div className="flex items-center gap-2 p-2 rounded bg-status-warning/10 text-status-warning text-xs">
                      <AlertCircle className="w-3 h-3" />
                      <span>Restart the server for changes to take effect</span>
                    </div>
                  )}
                </div>
              )}

              {/* Help text */}
              <p className="text-xs text-fg-3 pt-2">
                This should be the OpenClaw directory containing your agents/, skills/, memory/, and other workspace folders.
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
            Auto-detect gateway URL and installed agents from <span className="font-mono">~/.openclaw/openclaw.json</span>
          </p>
        </div>

        <div className="p-4 rounded-[var(--radius-lg)] bg-bg-2 border border-bd-0 space-y-4">
          {discoverLoading ? (
            <div className="flex items-center gap-2 text-fg-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Scanning local OpenClaw config...</span>
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
                        : discoverData?.status === 'offline'
                          ? 'bg-status-danger'
                          : 'bg-status-warning'
                    )}
                  />
                  <span className="text-sm text-fg-1">
                    {discoverData?.status === 'connected'
                      ? 'Connected'
                      : discoverData?.status === 'offline'
                        ? 'Offline'
                        : 'Not Found'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={loadDiscover}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-bg-3 text-fg-1 hover:bg-bg-4 transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Refresh
                  </button>
                  <button
                    onClick={handleManualSync}
                    disabled={syncing}
                    className={cn(
                      'flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-[var(--radius-md)] transition-colors',
                      syncing
                        ? 'bg-bg-3 text-fg-3 cursor-not-allowed'
                        : 'bg-status-info text-white hover:bg-status-info/90'
                    )}
                  >
                    <RefreshCw className={cn('w-3.5 h-3.5', syncing && 'animate-spin')} />
                    {syncing ? 'Syncing...' : 'Sync Now'}
                  </button>
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
                    <span className="text-fg-3">Token detected:</span>
                    <span className="text-fg-2">{discovered?.hasToken ? 'Yes' : 'No'}</span>
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

      {/* Layout Mode Section */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium text-fg-0">Layout Mode</h2>
          <p className="text-xs text-fg-2 mt-0.5">
            Layout selection is simplified to automatic mode
          </p>
        </div>

        <div className="p-4 rounded-[var(--radius-lg)] bg-bg-2 border border-bd-0 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-[var(--radius-md)] bg-bg-3">
                <Maximize2 className="w-4 h-4 text-fg-2" />
              </div>
              <div>
                <p className="text-sm font-medium text-fg-0">Auto</p>
                <p className="text-xs text-fg-2 mt-0.5">Adapts to your current screen shape</p>
              </div>
            </div>
            <span className="px-2 py-1 text-[11px] rounded-[var(--radius-md)] bg-status-info/10 text-status-info">
              Enabled
            </span>
          </div>

          <p className="text-xs text-fg-3">
            Current resolved layout: <span className="font-mono text-fg-2">{resolved}</span>
          </p>
        </div>
      </section>

      {/* Theme Section */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium text-fg-0">Theme</h2>
          <p className="text-xs text-fg-2 mt-0.5">
            Theme selection is simplified to automatic default
          </p>
        </div>

        <div className="p-4 rounded-[var(--radius-lg)] bg-bg-2 border border-bd-0 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-fg-0">Auto (Ops Dark)</p>
            <p className="text-xs text-fg-2 mt-0.5">Keeps the default monitoring theme enabled</p>
          </div>
          <span className="px-2 py-1 text-[11px] rounded-[var(--radius-md)] bg-status-info/10 text-status-info">
            Enabled
          </span>
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
            <div className="inline-flex items-center gap-1 p-1 rounded-[var(--radius-md)] bg-bg-3 border border-bd-0 shrink-0">
              <button
                type="button"
                onClick={() => setSkipTypedConfirm(false)}
                className={cn(
                  'px-2.5 py-1 text-xs font-medium rounded-[var(--radius-sm)] transition-colors',
                  !skipTypedConfirm
                    ? 'bg-bg-1 text-fg-0'
                    : 'text-fg-2 hover:text-fg-0'
                )}
                aria-pressed={!skipTypedConfirm}
              >
                Off
              </button>
              <button
                type="button"
                onClick={() => setSkipTypedConfirm(true)}
                className={cn(
                  'px-2.5 py-1 text-xs font-medium rounded-[var(--radius-sm)] transition-colors',
                  skipTypedConfirm
                    ? 'bg-status-warning text-black'
                    : 'text-fg-2 hover:text-fg-0'
                )}
                aria-pressed={skipTypedConfirm}
              >
                On
              </button>
            </div>
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
