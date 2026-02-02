'use client'

import { useState, useCallback } from 'react'
import { PageHeader, PageSection, EmptyState, TypedConfirmModal } from '@savorg/ui'
import { CanonicalTable, type Column } from '@/components/ui/canonical-table'
import { StatusPill } from '@/components/ui/status-pill'
import { RightDrawer } from '@/components/shell/right-drawer'
import { useProtectedAction } from '@/lib/hooks/useProtectedAction'
import { pluginsApi, type PluginWithConfig, type PluginDoctorResult, type PluginCapabilities, type PluginResponseMeta } from '@/lib/http'
import type { PluginDTO } from '@/lib/data'
import { cn } from '@/lib/utils'
import {
  Puzzle,
  Plus,
  Settings,
  Power,
  Loader2,
  Stethoscope,
  CheckCircle,
  AlertTriangle,
  XCircle,
  HelpCircle,
  AlertCircle,
  FileJson,
  Info,
  Trash2,
  Save,
  RotateCcw,
  X,
  ServerOff,
  CloudOff,
} from 'lucide-react'

type PluginSourceType = 'local' | 'npm' | 'tgz' | 'git'

interface Props {
  plugins: PluginDTO[]
  meta?: PluginResponseMeta
}

type TabId = 'overview' | 'config' | 'doctor'

const tabs: { id: TabId; label: string; icon: typeof Info }[] = [
  { id: 'overview', label: 'Overview', icon: Info },
  { id: 'config', label: 'Config', icon: FileJson },
  { id: 'doctor', label: 'Doctor', icon: Stethoscope },
]

// Doctor status icon component
function DoctorStatusIcon({ status }: { status?: PluginDoctorResult['status'] }) {
  if (!status || status === 'unchecked') {
    return <HelpCircle className="w-3.5 h-3.5 text-fg-3" />
  }
  switch (status) {
    case 'healthy':
      return <CheckCircle className="w-3.5 h-3.5 text-status-success" />
    case 'warning':
      return <AlertTriangle className="w-3.5 h-3.5 text-status-warning" />
    case 'unhealthy':
      return <XCircle className="w-3.5 h-3.5 text-status-error" />
  }
}

// Plugin status pill
function PluginStatusPill({ status, enabled }: { status: PluginDTO['status']; enabled: boolean }) {
  if (status === 'error') {
    return <StatusPill tone="danger" label="Error" />
  }
  if (status === 'updating') {
    return <StatusPill tone="progress" label="Updating" />
  }
  if (!enabled) {
    return <StatusPill tone="muted" label="Disabled" />
  }
  return <StatusPill tone="success" label="Active" />
}

const pluginColumns: Column<PluginDTO>[] = [
  {
    key: 'name',
    header: 'Plugin',
    width: '160px',
    mono: true,
    render: (row) => (
      <div className="flex items-center gap-2 whitespace-nowrap">
        <span
          className={cn(
            'w-2 h-2 rounded-full shrink-0',
            row.status === 'error'
              ? 'bg-status-error'
              : row.enabled
                ? 'bg-status-success'
                : 'bg-fg-3'
          )}
        />
        <span className="text-fg-0">{row.name}</span>
      </div>
    ),
  },
  {
    key: 'health',
    header: 'Health',
    width: '60px',
    align: 'center',
    render: (row) => <DoctorStatusIcon status={row.doctorResult?.status} />,
  },
  {
    key: 'description',
    header: 'Description',
    render: (row) => (
      <span className="text-fg-1 truncate max-w-[300px] inline-block">{row.description}</span>
    ),
  },
  {
    key: 'sourceType',
    header: 'Source',
    width: '70px',
    align: 'center',
    render: (row) => (
      <span className="text-fg-2 text-xs font-mono">{row.sourceType}</span>
    ),
  },
  {
    key: 'version',
    header: 'Version',
    width: '80px',
    align: 'center',
    mono: true,
    render: (row) => <span className="text-fg-2">{row.version}</span>,
  },
  {
    key: 'status',
    header: 'Status',
    width: '110px',
    align: 'right',
    render: (row) => <PluginStatusPill status={row.status} enabled={row.enabled} />,
  },
]

export function PluginsClient({ plugins: initialPlugins, meta: initialMeta }: Props) {
  const [plugins, setPlugins] = useState(initialPlugins)
  const [meta, setMeta] = useState<PluginResponseMeta | undefined>(initialMeta)
  const [selectedPlugin, setSelectedPlugin] = useState<PluginWithConfig | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isToggling, setIsToggling] = useState(false)
  const [isRunningDoctor, setIsRunningDoctor] = useState(false)
  const [isSavingConfig, setIsSavingConfig] = useState(false)
  const [isRestarting, setIsRestarting] = useState(false)
  const [isUninstalling, setIsUninstalling] = useState(false)
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [error, setError] = useState<string | null>(null)

  // Install modal state
  const [showInstallModal, setShowInstallModal] = useState(false)
  const [installSourceType, setInstallSourceType] = useState<PluginSourceType>('npm')
  const [installSpec, setInstallSpec] = useState('')
  const [isInstalling, setIsInstalling] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)
  const [isProbing, setIsProbing] = useState(false)

  const protectedAction = useProtectedAction()

  const enabledCount = plugins.filter((p) => p.enabled).length
  const errorCount = plugins.filter((p) => p.status === 'error').length
  const restartRequiredCount = plugins.filter((p) => p.restartRequired).length

  // Capability flags for disabling actions
  const capabilities = meta?.capabilities
  const isUnsupported = meta?.source === 'unsupported' || !capabilities?.supported
  const isDegraded = meta?.degraded && !isUnsupported

  // Re-probe capabilities
  const handleReprobe = useCallback(async () => {
    setIsProbing(true)
    try {
      await pluginsApi.getCapabilities({ refresh: true })
      // Refresh plugin list with new capabilities
      const listResult = await pluginsApi.list()
      setPlugins(listResult.data)
      setMeta(listResult.meta)
    } catch (err) {
      console.error('Failed to re-probe capabilities:', err)
      setError('Failed to refresh capabilities')
    } finally {
      setIsProbing(false)
    }
  }, [])

  // Load full plugin details when selecting
  const handleSelectPlugin = useCallback(async (plugin: PluginDTO) => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await pluginsApi.get(plugin.id)
      setSelectedPlugin(result.data)
      setActiveTab('overview')
    } catch (err) {
      console.error('Failed to load plugin:', err)
      setError('Failed to load plugin details')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Toggle enable/disable
  const handleToggleEnabled = useCallback(() => {
    if (!selectedPlugin) return

    const newEnabled = !selectedPlugin.enabled
    const actionKind = newEnabled ? 'plugin.enable' : 'plugin.disable'

    setError(null)

    protectedAction.trigger({
      actionKind,
      actionTitle: newEnabled ? 'Enable Plugin' : 'Disable Plugin',
      actionDescription: `${newEnabled ? 'Enable' : 'Disable'} the ${selectedPlugin.name} plugin`,
      entityName: selectedPlugin.name,
      onConfirm: async (typedConfirmText) => {
        setIsToggling(true)
        try {
          const result = await pluginsApi.update(selectedPlugin.id, {
            enabled: newEnabled,
            typedConfirmText,
          })

          // Update local state
          setSelectedPlugin(result.data)
          setPlugins((prev) =>
            prev.map((p) =>
              p.id === selectedPlugin.id
                ? { ...p, enabled: result.data.enabled, status: result.data.status }
                : p
            )
          )
        } finally {
          setIsToggling(false)
        }
      },
      onError: (err) => {
        console.error('Failed to toggle plugin:', err)
        setError('Failed to update plugin')
        setIsToggling(false)
      },
    })
  }, [selectedPlugin, protectedAction])

  // Run doctor
  const handleRunDoctor = useCallback(() => {
    if (!selectedPlugin) return

    setError(null)

    protectedAction.trigger({
      actionKind: 'plugin.doctor',
      actionTitle: 'Run Plugin Doctor',
      actionDescription: `Run diagnostics for the ${selectedPlugin.name} plugin`,
      entityName: selectedPlugin.name,
      onConfirm: async (typedConfirmText) => {
        setIsRunningDoctor(true)
        try {
          const result = await pluginsApi.doctor(selectedPlugin.id, typedConfirmText)

          // Update local state with new doctor result
          setSelectedPlugin((prev) =>
            prev ? { ...prev, doctorResult: result.data.doctorResult } : prev
          )
          setPlugins((prev) =>
            prev.map((p) =>
              p.id === selectedPlugin.id
                ? { ...p, doctorResult: result.data.doctorResult }
                : p
            )
          )

          // Switch to doctor tab to show results
          setActiveTab('doctor')
        } finally {
          setIsRunningDoctor(false)
        }
      },
      onError: (err) => {
        console.error('Failed to run doctor:', err)
        setError('Failed to run doctor')
        setIsRunningDoctor(false)
      },
    })
  }, [selectedPlugin, protectedAction])

  // Install plugin
  const handleInstall = useCallback(() => {
    if (!installSpec.trim()) {
      setInstallError('Spec is required')
      return
    }

    setInstallError(null)

    protectedAction.trigger({
      actionKind: 'plugin.install',
      actionTitle: 'Install Plugin',
      actionDescription: `Install plugin from ${installSourceType}: ${installSpec}`,
      onConfirm: async (typedConfirmText) => {
        setIsInstalling(true)
        try {
          const result = await pluginsApi.install({
            sourceType: installSourceType,
            spec: installSpec,
            typedConfirmText,
          })

          // Add to plugins list
          setPlugins((prev) => [...prev, result.data as unknown as PluginDTO])

          // Close modal and reset
          setShowInstallModal(false)
          setInstallSpec('')
          setInstallSourceType('npm')
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to install plugin'
          setInstallError(message)
        } finally {
          setIsInstalling(false)
        }
      },
      onError: (err) => {
        console.error('Failed to install plugin:', err)
        setInstallError(err.message)
        setIsInstalling(false)
      },
    })
  }, [installSourceType, installSpec, protectedAction])

  // Uninstall plugin
  const handleUninstall = useCallback(() => {
    if (!selectedPlugin) return

    setError(null)

    protectedAction.trigger({
      actionKind: 'plugin.uninstall',
      actionTitle: 'Uninstall Plugin',
      actionDescription: `Permanently remove the ${selectedPlugin.name} plugin`,
      entityName: selectedPlugin.name,
      onConfirm: async (typedConfirmText) => {
        setIsUninstalling(true)
        try {
          await pluginsApi.uninstall(selectedPlugin.id, typedConfirmText)

          // Remove from plugins list
          setPlugins((prev) => prev.filter((p) => p.id !== selectedPlugin.id))

          // Close drawer
          setSelectedPlugin(null)
        } finally {
          setIsUninstalling(false)
        }
      },
      onError: (err) => {
        console.error('Failed to uninstall plugin:', err)
        setError('Failed to uninstall plugin')
        setIsUninstalling(false)
      },
    })
  }, [selectedPlugin, protectedAction])

  // Save config
  const handleSaveConfig = useCallback((newConfig: Record<string, unknown>) => {
    if (!selectedPlugin) return

    setError(null)

    protectedAction.trigger({
      actionKind: 'plugin.edit_config',
      actionTitle: 'Update Plugin Config',
      actionDescription: `Update configuration for the ${selectedPlugin.name} plugin`,
      entityName: selectedPlugin.name,
      onConfirm: async (typedConfirmText) => {
        setIsSavingConfig(true)
        try {
          const result = await pluginsApi.updateConfig(selectedPlugin.id, {
            config: newConfig,
            typedConfirmText,
          })

          // Update local state
          setSelectedPlugin(result.data)
          setPlugins((prev) =>
            prev.map((p) =>
              p.id === selectedPlugin.id
                ? { ...p, restartRequired: result.data.restartRequired }
                : p
            )
          )
        } finally {
          setIsSavingConfig(false)
        }
      },
      onError: (err) => {
        console.error('Failed to save config:', err)
        setError(err.message || 'Failed to save config')
        setIsSavingConfig(false)
      },
    })
  }, [selectedPlugin, protectedAction])

  // Restart plugins
  const handleRestart = useCallback(() => {
    setError(null)

    protectedAction.trigger({
      actionKind: 'plugin.restart',
      actionTitle: 'Restart Plugins',
      actionDescription: `Restart ${restartRequiredCount} plugin(s) to apply configuration changes`,
      onConfirm: async (typedConfirmText) => {
        setIsRestarting(true)
        try {
          await pluginsApi.restart(typedConfirmText)

          // Clear restartRequired flags locally
          setPlugins((prev) =>
            prev.map((p) => ({ ...p, restartRequired: false }))
          )
          if (selectedPlugin) {
            setSelectedPlugin((prev) =>
              prev ? { ...prev, restartRequired: false } : prev
            )
          }
        } finally {
          setIsRestarting(false)
        }
      },
      onError: (err) => {
        console.error('Failed to restart plugins:', err)
        setError('Failed to restart plugins')
        setIsRestarting(false)
      },
    })
  }, [restartRequiredCount, selectedPlugin, protectedAction])

  return (
    <>
      <div className="w-full space-y-4">
        <PageHeader
          title="Plugins"
          subtitle={
            errorCount > 0
              ? `${enabledCount} active / ${errorCount} with errors / ${plugins.length} total`
              : `${enabledCount} active / ${plugins.length} installed`
          }
          actions={
            <div className="flex items-center gap-2">
              <button
                className="btn-secondary flex items-center gap-1.5"
                onClick={() => setShowInstallModal(true)}
                disabled={isUnsupported || !capabilities?.install}
                title={!capabilities?.install ? 'Install not supported by OpenClaw' : undefined}
              >
                <Plus className="w-3.5 h-3.5" />
                Install
              </button>
            </div>
          }
        />

        {/* Unsupported Banner */}
        {isUnsupported && (
          <div className="p-3 bg-status-error/10 border border-status-error/30 rounded-md flex items-center gap-3">
            <ServerOff className="w-5 h-5 text-status-error shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-status-error">
                Plugin Management Not Available
              </p>
              <p className="text-xs text-fg-2 mt-0.5">
                {meta?.message || 'OpenClaw does not support plugin commands. Plugin functionality is read-only.'}
              </p>
            </div>
            <button
              onClick={handleReprobe}
              disabled={isProbing}
              className="btn-secondary flex items-center gap-1.5 text-xs shrink-0"
              title="Re-probe OpenClaw capabilities"
            >
              {isProbing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RotateCcw className="w-3.5 h-3.5" />
              )}
              Re-probe
            </button>
          </div>
        )}

        {/* Degraded Mode Banner */}
        {isDegraded && (
          <div className="p-3 bg-status-warning/10 border border-status-warning/30 rounded-md flex items-center gap-3">
            <CloudOff className="w-5 h-5 text-status-warning shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-status-warning">
                Limited Plugin Management
              </p>
              <p className="text-xs text-fg-2 mt-0.5">
                {meta?.message || 'Some plugin features are not available in this OpenClaw version.'}
              </p>
            </div>
            <button
              onClick={handleReprobe}
              disabled={isProbing}
              className="btn-secondary flex items-center gap-1.5 text-xs shrink-0"
              title="Re-probe OpenClaw capabilities"
            >
              {isProbing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RotateCcw className="w-3.5 h-3.5" />
              )}
              Re-probe
            </button>
          </div>
        )}

        {/* Global Restart Required Banner */}
        {restartRequiredCount > 0 && (
          <div className="p-3 bg-status-warning/10 border border-status-warning/30 rounded-md flex items-center justify-between">
            <div className="flex items-center gap-2 text-status-warning">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="text-sm">
                {restartRequiredCount} plugin{restartRequiredCount > 1 ? 's' : ''} require restart to apply changes
              </span>
            </div>
            <button
              onClick={handleRestart}
              disabled={isRestarting}
              className="btn-secondary flex items-center gap-1.5 text-status-warning border-status-warning/30 hover:bg-status-warning/10"
            >
              {isRestarting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RotateCcw className="w-3.5 h-3.5" />
              )}
              Restart Now
            </button>
          </div>
        )}

        <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-white/[0.06] overflow-hidden">
          <CanonicalTable
            columns={pluginColumns}
            rows={plugins}
            rowKey={(row) => row.id}
            onRowClick={handleSelectPlugin}
            selectedKey={selectedPlugin?.id}
            density="compact"
            emptyState={
              <EmptyState
                icon={<Puzzle className="w-8 h-8" />}
                title="No plugins installed"
                description="Plugins add integrations and capabilities"
              />
            }
          />
        </div>
      </div>

      {/* Detail Drawer */}
      <RightDrawer
        open={!!selectedPlugin}
        onClose={() => setSelectedPlugin(null)}
        title={selectedPlugin?.name}
        description={selectedPlugin?.description}
      >
        {selectedPlugin && (
          <PluginDetail
            plugin={selectedPlugin}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            isLoading={isLoading}
            isToggling={isToggling}
            isRunningDoctor={isRunningDoctor}
            isSavingConfig={isSavingConfig}
            isUninstalling={isUninstalling}
            error={error}
            capabilities={capabilities}
            onToggleEnabled={handleToggleEnabled}
            onRunDoctor={handleRunDoctor}
            onSaveConfig={handleSaveConfig}
            onUninstall={handleUninstall}
          />
        )}
      </RightDrawer>

      {/* Install Modal */}
      {showInstallModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowInstallModal(false)}
          />
          <div className="relative bg-bg-1 border border-white/[0.06] rounded-lg shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-fg-0">Install Plugin</h2>
              <button
                onClick={() => setShowInstallModal(false)}
                className="text-fg-2 hover:text-fg-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {installError && (
              <div className="mb-4 p-3 bg-status-error/10 border border-status-error/30 rounded-md text-sm text-status-error">
                {installError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-fg-1 mb-2">
                  Source Type
                </label>
                <div className="flex gap-2">
                  {(['npm', 'git', 'local', 'tgz'] as PluginSourceType[]).map((type) => (
                    <button
                      key={type}
                      onClick={() => setInstallSourceType(type)}
                      className={cn(
                        'px-3 py-1.5 text-sm font-mono rounded-md border transition-colors',
                        installSourceType === type
                          ? 'bg-accent-primary/10 border-accent-primary text-accent-primary'
                          : 'border-white/[0.06] text-fg-2 hover:text-fg-1 hover:border-bd-1'
                      )}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-fg-1 mb-2">
                  {installSourceType === 'npm' && 'Package Name (e.g., @savorg/plugin-github)'}
                  {installSourceType === 'git' && 'Git URL (e.g., https://github.com/org/repo.git)'}
                  {installSourceType === 'local' && 'Local Path (e.g., /opt/savorg/plugins/my-plugin)'}
                  {installSourceType === 'tgz' && 'Tarball Path (e.g., /path/to/plugin.tgz)'}
                </label>
                <input
                  type="text"
                  value={installSpec}
                  onChange={(e) => setInstallSpec(e.target.value)}
                  placeholder={
                    installSourceType === 'npm'
                      ? '@savorg/plugin-example@1.0.0'
                      : installSourceType === 'git'
                        ? 'https://github.com/org/plugin.git'
                        : installSourceType === 'local'
                          ? '/usr/local/lib/savorg/plugins/my-plugin'
                          : '/path/to/plugin.tgz'
                  }
                  className="w-full px-3 py-2 bg-bg-2 border border-white/[0.06] rounded-md font-mono text-sm text-fg-0 placeholder:text-fg-3 focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowInstallModal(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleInstall}
                disabled={isInstalling || !installSpec.trim()}
                className="btn-primary flex items-center gap-1.5"
              >
                {isInstalling ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Plus className="w-3.5 h-3.5" />
                )}
                Install
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Modal */}
      <TypedConfirmModal
        isOpen={protectedAction.state.isOpen}
        onClose={protectedAction.cancel}
        onConfirm={protectedAction.confirm}
        actionTitle={protectedAction.state.actionTitle}
        actionDescription={protectedAction.state.actionDescription}
        confirmMode={protectedAction.confirmMode}
        riskLevel={protectedAction.riskLevel}
        entityName={protectedAction.state.entityName}
        isLoading={protectedAction.state.isLoading}
      />
    </>
  )
}

interface PluginDetailProps {
  plugin: PluginWithConfig
  activeTab: TabId
  onTabChange: (tab: TabId) => void
  isLoading: boolean
  isToggling: boolean
  isRunningDoctor: boolean
  isSavingConfig: boolean
  isUninstalling: boolean
  error: string | null
  capabilities?: PluginCapabilities
  onToggleEnabled: () => void
  onRunDoctor: () => void
  onSaveConfig: (config: Record<string, unknown>) => void
  onUninstall: () => void
}

function PluginDetail({
  plugin,
  activeTab,
  onTabChange,
  isLoading,
  isToggling,
  isRunningDoctor,
  isSavingConfig,
  isUninstalling,
  error,
  capabilities,
  onToggleEnabled,
  onRunDoctor,
  onSaveConfig,
  onUninstall,
}: PluginDetailProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="w-6 h-6 animate-spin text-fg-2" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tabs - negative margin to extend to drawer edges */}
      <div className="flex gap-1 border-b border-white/[0.06] -mx-4 px-4">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === tab.id
                ? 'border-accent-primary text-fg-0'
                : 'border-transparent text-fg-2 hover:text-fg-1'
            )}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mt-4 p-3 bg-status-error/10 border border-status-error/30 rounded-md text-sm text-status-error">
          {error}
        </div>
      )}

      {/* Restart Required Banner */}
      {plugin.restartRequired && (
        <div className="mt-4 p-3 bg-status-warning/10 border border-status-warning/30 rounded-md text-sm text-status-warning flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Gateway restart required for changes to take effect</span>
        </div>
      )}

      {/* Tab Content - no extra padding since drawer provides it */}
      <div className="flex-1 overflow-auto pt-4">
        {activeTab === 'overview' && (
          <OverviewTab
            plugin={plugin}
            isToggling={isToggling}
            isUninstalling={isUninstalling}
            capabilities={capabilities}
            onToggleEnabled={onToggleEnabled}
            onUninstall={onUninstall}
          />
        )}
        {activeTab === 'config' && (
          <ConfigTab
            plugin={plugin}
            isSaving={isSavingConfig}
            capabilities={capabilities}
            onSaveConfig={onSaveConfig}
          />
        )}
        {activeTab === 'doctor' && (
          <DoctorTab
            plugin={plugin}
            isRunningDoctor={isRunningDoctor}
            capabilities={capabilities}
            onRunDoctor={onRunDoctor}
          />
        )}
      </div>
    </div>
  )
}

function OverviewTab({
  plugin,
  isToggling,
  isUninstalling,
  capabilities,
  onToggleEnabled,
  onUninstall,
}: {
  plugin: PluginWithConfig
  isToggling: boolean
  isUninstalling: boolean
  capabilities?: PluginCapabilities
  onToggleEnabled: () => void
  onUninstall: () => void
}) {
  const canToggle = plugin.enabled ? capabilities?.disable : capabilities?.enable
  const canUninstall = capabilities?.uninstall
  return (
    <div className="space-y-6">
      {/* Status & Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <PluginStatusPill status={plugin.status} enabled={plugin.enabled} />
          <span className="font-mono text-xs text-fg-2">v{plugin.version}</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onToggleEnabled}
            disabled={isToggling || !canToggle}
            title={!canToggle ? `${plugin.enabled ? 'Disable' : 'Enable'} not supported by OpenClaw` : undefined}
            className={cn(
              'btn-secondary flex items-center gap-1.5',
              plugin.enabled ? 'text-status-error' : 'text-status-success'
            )}
          >
            {isToggling ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Power className="w-3.5 h-3.5" />
            )}
            {plugin.enabled ? 'Disable' : 'Enable'}
          </button>
          <button
            onClick={onUninstall}
            disabled={isUninstalling || !canUninstall}
            title={!canUninstall ? 'Uninstall not supported by OpenClaw' : undefined}
            className="btn-secondary flex items-center gap-1.5 text-status-error"
          >
            {isUninstalling ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Trash2 className="w-3.5 h-3.5" />
            )}
            Uninstall
          </button>
        </div>
      </div>

      {/* Last Error */}
      {plugin.lastError && (
        <div className="p-3 bg-status-error/10 border border-status-error/30 rounded-md">
          <p className="text-sm text-status-error font-medium">Last Error</p>
          <p className="text-sm text-fg-1 mt-1">{plugin.lastError}</p>
        </div>
      )}

      {/* Description */}
      <PageSection title="Description">
        <p className="text-sm text-fg-1">{plugin.description}</p>
      </PageSection>

      {/* Source */}
      <PageSection title="Source">
        <div className="bg-bg-1 rounded-md p-3 font-mono text-xs">
          <div className="flex items-center gap-2">
            <span className="text-fg-2">{plugin.sourceType}:</span>
            <span className="text-fg-0">
              {plugin.npmSpec || plugin.sourcePath || 'N/A'}
            </span>
          </div>
        </div>
      </PageSection>

      {/* Info */}
      <PageSection title="Details">
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-fg-2">Author</dt>
          <dd className="text-fg-1">{plugin.author}</dd>
          <dt className="text-fg-2">Installed</dt>
          <dd className="text-fg-1 font-mono text-xs">
            {new Date(plugin.installedAt).toLocaleDateString()}
          </dd>
          <dt className="text-fg-2">Updated</dt>
          <dd className="text-fg-1 font-mono text-xs">
            {new Date(plugin.updatedAt).toLocaleDateString()}
          </dd>
          <dt className="text-fg-2">Has Config</dt>
          <dd className="text-fg-1">{plugin.hasConfig ? 'Yes' : 'No'}</dd>
        </dl>
      </PageSection>
    </div>
  )
}

function ConfigTab({
  plugin,
  isSaving,
  capabilities,
  onSaveConfig,
}: {
  plugin: PluginWithConfig
  isSaving: boolean
  capabilities?: PluginCapabilities
  onSaveConfig: (config: Record<string, unknown>) => void
}) {
  const canSaveConfig = capabilities?.setConfig
  const [configText, setConfigText] = useState(
    JSON.stringify(plugin.configJson || {}, null, 2)
  )
  const [parseError, setParseError] = useState<string | null>(null)
  const [hasChanges, setHasChanges] = useState(false)

  const handleConfigChange = (value: string) => {
    setConfigText(value)
    setHasChanges(value !== JSON.stringify(plugin.configJson || {}, null, 2))

    // Validate JSON
    try {
      JSON.parse(value)
      setParseError(null)
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Invalid JSON')
    }
  }

  const handleSave = () => {
    try {
      const parsed = JSON.parse(configText)
      onSaveConfig(parsed)
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Invalid JSON')
    }
  }

  const handleReset = () => {
    setConfigText(JSON.stringify(plugin.configJson || {}, null, 2))
    setParseError(null)
    setHasChanges(false)
  }

  if (!plugin.hasConfig) {
    return (
      <EmptyState
        icon={<Settings className="w-8 h-8" />}
        title="No configuration"
        description="This plugin doesn't require configuration"
      />
    )
  }

  return (
    <div className="space-y-4">
      {/* Schema info if available */}
      {plugin.configSchema && (
        <PageSection title="Config Schema">
          <div className="space-y-2">
            {Object.entries(plugin.configSchema.properties || {}).map(([key, prop]) => (
              <div
                key={key}
                className="flex items-start gap-2 text-sm p-2 bg-bg-1 rounded-md"
              >
                <code className="text-accent-primary font-mono">{key}</code>
                <span className="text-fg-2">({prop.type})</span>
                {plugin.configSchema?.required?.includes(key) && (
                  <span className="text-xs px-1.5 py-0.5 bg-status-error/20 text-status-error rounded">
                    required
                  </span>
                )}
                {prop.description && (
                  <span className="text-fg-1 text-xs">{prop.description}</span>
                )}
              </div>
            ))}
          </div>
        </PageSection>
      )}

      {/* JSON Editor */}
      <PageSection title="Configuration">
        <div className="space-y-2">
          <textarea
            value={configText}
            onChange={(e) => handleConfigChange(e.target.value)}
            spellCheck={false}
            className={cn(
              'w-full h-[200px] bg-bg-2 border rounded-md p-3 font-mono text-xs text-fg-0 resize-none focus:outline-none focus:ring-2',
              parseError
                ? 'border-status-error focus:ring-status-error/50'
                : 'border-white/[0.06] focus:ring-accent-primary/50'
            )}
          />
          {parseError && (
            <p className="text-xs text-status-error">{parseError}</p>
          )}
        </div>
      </PageSection>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-fg-2">
          {hasChanges ? 'You have unsaved changes' : 'No changes'}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            disabled={!hasChanges || isSaving}
            className="btn-secondary flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges || !!parseError || isSaving || !canSaveConfig}
            title={!canSaveConfig ? 'Config editing not supported by OpenClaw' : undefined}
            className="btn-primary flex items-center gap-1.5"
          >
            {isSaving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            Save Config
          </button>
        </div>
      </div>
    </div>
  )
}

function DoctorTab({
  plugin,
  isRunningDoctor,
  capabilities,
  onRunDoctor,
}: {
  plugin: PluginWithConfig
  isRunningDoctor: boolean
  capabilities?: PluginCapabilities
  onRunDoctor: () => void
}) {
  const canRunDoctor = capabilities?.doctor
  const doctorResult = plugin.doctorResult

  return (
    <div className="space-y-4">
      {/* Run Doctor Button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {doctorResult && (
            <>
              <DoctorStatusIcon status={doctorResult.status} />
              <span
                className={cn(
                  'text-sm font-medium',
                  doctorResult.status === 'healthy'
                    ? 'text-status-success'
                    : doctorResult.status === 'warning'
                      ? 'text-status-warning'
                      : doctorResult.status === 'unhealthy'
                        ? 'text-status-error'
                        : 'text-fg-2'
                )}
              >
                {doctorResult.summary}
              </span>
            </>
          )}
        </div>

        <button
          onClick={onRunDoctor}
          disabled={isRunningDoctor || !canRunDoctor}
          title={!canRunDoctor ? 'Doctor not supported by OpenClaw' : undefined}
          className="btn-secondary flex items-center gap-1.5"
        >
          {isRunningDoctor ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Stethoscope className="w-3.5 h-3.5" />
          )}
          Run Doctor
        </button>
      </div>

      {/* Doctor Results */}
      {doctorResult ? (
        <div className="space-y-2">
          {doctorResult.checks.map((check, idx) => (
            <div
              key={idx}
              className={cn(
                'p-3 rounded-md border',
                check.status === 'pass'
                  ? 'bg-status-success/5 border-status-success/30'
                  : check.status === 'warn'
                    ? 'bg-status-warning/5 border-status-warning/30'
                    : 'bg-status-error/5 border-status-error/30'
              )}
            >
              <div className="flex items-center gap-2">
                {check.status === 'pass' ? (
                  <CheckCircle className="w-4 h-4 text-status-success shrink-0" />
                ) : check.status === 'warn' ? (
                  <AlertTriangle className="w-4 h-4 text-status-warning shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-status-error shrink-0" />
                )}
                <span className="text-sm font-medium text-fg-0">{check.name}</span>
              </div>
              <p className="text-sm text-fg-1 mt-1 ml-6">{check.message}</p>
              {check.details && (
                <p className="text-xs text-fg-2 mt-1 ml-6 font-mono">{check.details}</p>
              )}
            </div>
          ))}

          {/* Last checked */}
          <p className="text-xs text-fg-2 mt-4">
            Last checked: {new Date(doctorResult.checkedAt).toLocaleString()}
            {doctorResult.receiptId && (
              <span className="ml-2">
                (Receipt: <code className="text-accent-primary">{doctorResult.receiptId}</code>)
              </span>
            )}
          </p>
        </div>
      ) : (
        <EmptyState
          icon={<Stethoscope className="w-8 h-8" />}
          title="No doctor results"
          description="Run doctor to check plugin health"
        />
      )}
    </div>
  )
}
