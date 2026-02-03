'use client'

import { useState, useEffect } from 'react'
import { useLayout, type LayoutMode } from '@/lib/layout-context'
import { useSettings, type Theme, type Density } from '@/lib/settings-context'
import { configApi, type EnvConfigResponse } from '@/lib/http'
import { cn } from '@/lib/utils'
import {
  Monitor,
  Smartphone,
  Maximize2,
  Check,
  FolderOpen,
  AlertCircle,
  RefreshCw,
  Save,
  Loader2,
} from 'lucide-react'

export default function SettingsPage() {
  const { mode, setMode, resolved } = useLayout()
  const { theme, setTheme, density, setDensity } = useSettings()

  // Environment config state
  const [envConfig, setEnvConfig] = useState<EnvConfigResponse | null>(null)
  const [envLoading, setEnvLoading] = useState(true)
  const [envError, setEnvError] = useState<string | null>(null)
  const [workspacePath, setWorkspacePath] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Load environment config
  useEffect(() => {
    loadEnvConfig()
  }, [])

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

  async function handleSaveWorkspace() {
    setSaving(true)
    setSaveSuccess(false)
    setEnvError(null)
    try {
      const res = await configApi.updateEnv({
        OPENCLAW_WORKSPACE: workspacePath || null,
      })
      setEnvConfig(res.data)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err) {
      setEnvError(err instanceof Error ? err.message : 'Failed to save config')
    } finally {
      setSaving(false)
    }
  }

  const hasWorkspaceChanges = envConfig && workspacePath !== (envConfig.config.OPENCLAW_WORKSPACE || '')

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-lg font-semibold text-fg-0">Settings</h1>
        <p className="text-sm text-fg-2 mt-1">Configure Mission Control preferences</p>
      </div>

      {/* Workspace Configuration Section */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium text-fg-0">Workspace</h2>
          <p className="text-xs text-fg-2 mt-0.5">
            Configure the OpenClaw workspace directory (agents/, skills/, etc.)
          </p>
        </div>

        <div className="p-4 rounded-[var(--radius-lg)] bg-bg-2 border border-white/[0.06] space-y-4">
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
                    className="flex-1 px-3 py-2 text-sm bg-bg-1 border border-white/[0.06] rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-3 focus:outline-none focus:border-status-info/50"
                  />
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
                    {saving ? 'Saving...' : saveSuccess ? 'Saved' : 'Save'}
                  </button>
                </div>
              </div>

              {/* Current active workspace info */}
              {envConfig?.activeWorkspace && (
                <div className="pt-3 border-t border-white/[0.06] space-y-2">
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
                This should be the directory containing your agents/, skills/, memory/, and other workspace folders.
                Changes require a server restart.
              </p>
            </>
          )}
        </div>
      </section>

      {/* Layout Mode Section */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium text-fg-0">Layout Mode</h2>
          <p className="text-xs text-fg-2 mt-0.5">
            Choose how the interface adapts to your display
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <LayoutModeCard
            mode="auto"
            label="Auto"
            description="Adapts based on screen aspect ratio"
            icon={Maximize2}
            selected={mode === 'auto'}
            onSelect={() => setMode('auto')}
          />
          <LayoutModeCard
            mode="horizontal"
            label="Horizontal"
            description="Optimized for wide monitors"
            icon={Monitor}
            selected={mode === 'horizontal'}
            onSelect={() => setMode('horizontal')}
          />
          <LayoutModeCard
            mode="vertical"
            label="Vertical"
            description="Optimized for portrait displays"
            icon={Smartphone}
            selected={mode === 'vertical'}
            onSelect={() => setMode('vertical')}
          />
        </div>

        <p className="text-xs text-fg-3">
          Current resolved layout: <span className="font-mono text-fg-2">{resolved}</span>
        </p>
      </section>

      {/* Theme Section */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium text-fg-0">Theme</h2>
          <p className="text-xs text-fg-2 mt-0.5">
            Visual appearance settings
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ThemeCard
            theme="dark"
            label="Ops Dark"
            description="High contrast for extended monitoring"
            selected={theme === 'dark'}
            onSelect={() => setTheme('dark')}
          />
          <ThemeCard
            theme="dim"
            label="Ops Dim"
            description="Lower contrast for comfortable viewing"
            selected={theme === 'dim'}
            onSelect={() => setTheme('dim')}
          />
        </div>
      </section>

      {/* Density Section */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium text-fg-0">Display Density</h2>
          <p className="text-xs text-fg-2 mt-0.5">
            How compact the interface should be
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <DensityCard
            density="compact"
            label="Compact"
            description="More information per screen"
            selected={density === 'compact'}
            onSelect={() => setDensity('compact')}
          />
          <DensityCard
            density="default"
            label="Default"
            description="More breathing room"
            selected={density === 'default'}
            onSelect={() => setDensity('default')}
          />
        </div>
      </section>
    </div>
  )
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function LayoutModeCard({
  label,
  description,
  icon: Icon,
  selected,
  onSelect,
}: {
  mode?: LayoutMode
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex flex-col items-start p-4 rounded-[var(--radius-lg)] border transition-all text-left',
        selected
          ? 'bg-bg-3 border-status-info/50 ring-1 ring-status-info/20'
          : 'bg-bg-2 border-white/[0.06] hover:border-bd-1 hover:bg-bg-3/50'
      )}
    >
      <div className="flex items-center justify-between w-full mb-2">
        <Icon className={cn('w-5 h-5', selected ? 'text-status-info' : 'text-fg-2')} />
        {selected && <Check className="w-4 h-4 text-status-info" />}
      </div>
      <span className={cn('text-sm font-medium', selected ? 'text-fg-0' : 'text-fg-1')}>
        {label}
      </span>
      <span className="text-xs text-fg-2 mt-0.5">{description}</span>
    </button>
  )
}

function ThemeCard({
  label,
  description,
  selected,
  onSelect,
}: {
  theme?: Theme
  label: string
  description: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex items-center justify-between p-4 rounded-[var(--radius-lg)] border transition-all text-left',
        selected
          ? 'bg-bg-3 border-status-info/50 ring-1 ring-status-info/20'
          : 'bg-bg-2 border-white/[0.06] hover:border-bd-1 hover:bg-bg-3/50'
      )}
    >
      <div>
        <span className={cn('text-sm font-medium', selected ? 'text-fg-0' : 'text-fg-1')}>
          {label}
        </span>
        <p className="text-xs text-fg-2 mt-0.5">{description}</p>
      </div>
      {selected && <Check className="w-4 h-4 text-status-info shrink-0" />}
    </button>
  )
}

function DensityCard({
  label,
  description,
  selected,
  onSelect,
}: {
  density?: Density
  label: string
  description: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex items-center justify-between p-4 rounded-[var(--radius-lg)] border transition-all text-left',
        selected
          ? 'bg-bg-3 border-status-info/50 ring-1 ring-status-info/20'
          : 'bg-bg-2 border-white/[0.06] hover:border-bd-1 hover:bg-bg-3/50'
      )}
    >
      <div>
        <span className={cn('text-sm font-medium', selected ? 'text-fg-0' : 'text-fg-1')}>
          {label}
        </span>
        <p className="text-xs text-fg-2 mt-0.5">{description}</p>
      </div>
      {selected && <Check className="w-4 h-4 text-status-info shrink-0" />}
    </button>
  )
}
