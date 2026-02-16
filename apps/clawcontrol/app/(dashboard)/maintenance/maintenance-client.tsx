'use client'

import { useState, useCallback, useEffect } from 'react'
import { PageHeader, PageSection, TypedConfirmModal, Button } from '@clawcontrol/ui'
import { LoadingSpinner, LoadingState } from '@/components/ui/loading-state'
import { StatusPill } from '@/components/ui/status-pill'
import { RightDrawer } from '@/components/shell/right-drawer'
import { YamlEditor } from '@/components/editors/yaml-editor'
import { CopyButton } from '@/components/prompt-kit/code-block/copy-button'
import {
  playbooksApi,
  maintenanceApi,
  type PlaybookWithContent,
  type MaintenanceStatus,
  type PlaybookRunResult,
  type MaintenanceErrorSummary,
  type MaintenanceErrorSignature,
  HttpError,
} from '@/lib/http'
import { useProtectedAction } from '@/lib/hooks/useProtectedAction'
import { useSettings } from '@/lib/settings-context'
import type { GatewayStatusDTO } from '@/lib/data'
import type { ActionKind } from '@clawcontrol/core'
import { cn } from '@/lib/utils'
import {
  RefreshCw,
  Database,
  Wifi,
  Server,
  Play,
  Trash2,
  RotateCcw,
  FileCode,
  Edit3,
  Stethoscope,
  Wrench,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Bot,
} from 'lucide-react'

interface Props {
  gateway: GatewayStatusDTO
  playbooks: Array<{
    id: string
    name: string
    description: string
    severity: 'info' | 'warn' | 'critical'
    modifiedAt: Date
  }>
}

type MaintenanceAction =
  | 'health'
  | 'doctor'
  | 'doctor-fix'
  | 'cache-clear'
  | 'sessions-reset'
  | 'greenfield-reset'
  | 'gateway-restart'
  | 'security-audit-fix'
  | 'recover'

const ACTION_CONFIG: Record<MaintenanceAction, {
  title: string
  description: string
  actionKind: ActionKind
  icon: React.ComponentType<{ className?: string }>
}> = {
  'health': {
    title: 'Run Health Check',
    description: 'Verify all connections and services',
    actionKind: 'maintenance.health_check',
    icon: RefreshCw,
  },
  'doctor': {
    title: 'Run Doctor',
    description: 'Run diagnostics to identify issues',
    actionKind: 'doctor.run',
    icon: Stethoscope,
  },
  'doctor-fix': {
    title: 'Run Doctor (Auto-Fix)',
    description: 'Run diagnostics and apply automatic fixes',
    actionKind: 'doctor.fix',
    icon: Wrench,
  },
  'cache-clear': {
    title: 'Clear Cache',
    description: 'Purge all cached data',
    actionKind: 'maintenance.cache_clear',
    icon: Trash2,
  },
  'sessions-reset': {
    title: 'Reset Sessions',
    description: 'Disconnect all agents and reset sessions',
    actionKind: 'maintenance.sessions_reset',
    icon: RotateCcw,
  },
  'greenfield-reset': {
    title: 'Greenfield Reset',
    description: 'Delete teams, non-main agents, workflows, and operational records',
    actionKind: 'maintenance.greenfield_reset',
    icon: Trash2,
  },
  'gateway-restart': {
    title: 'Restart Gateway',
    description: 'Restart the OpenClaw gateway service',
    actionKind: 'gateway.restart',
    icon: RotateCcw,
  },
  'security-audit-fix': {
    title: 'Run Security Audit (Fix)',
    description: 'Run security audit and apply safe remediations',
    actionKind: 'security.audit.fix',
    icon: Wrench,
  },
  'recover': {
    title: 'Recover Gateway',
    description: 'Run full recovery playbook (health → doctor → fix → restart)',
    actionKind: 'maintenance.recover_gateway',
    icon: Wrench,
  },
}

export function MaintenanceClient({ gateway: initialGateway, playbooks: initialPlaybooks }: Props) {
  const { skipTypedConfirm } = useSettings()
  const [gateway, setGateway] = useState(initialGateway)
  const [playbooks, setPlaybooks] = useState(initialPlaybooks)
  const [selectedPlaybook, setSelectedPlaybook] = useState<PlaybookWithContent | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [playbookContent, setPlaybookContent] = useState<string>('')
  const [runningAction, setRunningAction] = useState<MaintenanceAction | null>(null)
  const [runningPlaybookId, setRunningPlaybookId] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<{
    action: MaintenanceAction | 'playbook'
    success: boolean
    message: string
    receiptId?: string
    playbookResult?: PlaybookRunResult
  } | null>(null)
  const [cliStatus, setCliStatus] = useState<{
    available: boolean
    version: string | null
    minVersion: string
    belowMinVersion?: boolean
    error?: string
  } | null>(null)

  const [localOnly, setLocalOnly] = useState<MaintenanceStatus['localOnly'] | null>(null)
  const [errorSummary, setErrorSummary] = useState<MaintenanceErrorSummary | null>(null)
  const [errorSignatures, setErrorSignatures] = useState<MaintenanceErrorSignature[]>([])
  const [errorSummaryLoading, setErrorSummaryLoading] = useState(false)
  const [errorSignaturesLoading, setErrorSignaturesLoading] = useState(false)
  const [includeRawEvidence, setIncludeRawEvidence] = useState(false)
  const [drawerIncludeRawEvidence, setDrawerIncludeRawEvidence] = useState(false)
  const [drawerRawEvidenceByHash, setDrawerRawEvidenceByHash] = useState<Record<string, string>>({})
  const [drawerRawEvidenceLoading, setDrawerRawEvidenceLoading] = useState(false)
  const [selectedErrorHash, setSelectedErrorHash] = useState<string | null>(null)
  const [remediationState, setRemediationState] = useState<{
    signatureHash: string
    mode: 'create' | 'create_and_start'
  } | null>(null)
  const [errorWorkflowResult, setErrorWorkflowResult] = useState<{
    signatureHash: string
    success: boolean
    message: string
    workOrderId: string
    code: string
  } | null>(null)
  const [relativeNowMs, setRelativeNowMs] = useState(() => Date.now())

  const selectedErrorSignature = selectedErrorHash
    ? errorSignatures.find((signature) => signature.signatureHash === selectedErrorHash) ?? null
    : null
  const selectedRawEvidence = selectedErrorSignature
    ? (selectedErrorSignature.rawRedactedSample ?? drawerRawEvidenceByHash[selectedErrorSignature.signatureHash] ?? null)
    : null
  const selectedEvidenceText = selectedErrorSignature
    ? drawerIncludeRawEvidence
      ? (selectedRawEvidence ?? selectedErrorSignature.sample)
      : selectedErrorSignature.sample
    : ''

  const protectedAction = useProtectedAction({ skipTypedConfirm })

  const applyMaintenanceStatus = useCallback((status: MaintenanceStatus) => {
    const version = status.status.version ?? status.cliVersion ?? undefined
    const uptime = status.status.uptime
    const lastCheckTimestamp = status.health.timestamp || status.timestamp

    setGateway((prev) => ({
      ...prev,
      status: status.health.status,
      latencyMs: typeof status.probe.latencyMs === 'number' ? status.probe.latencyMs : prev.latencyMs,
      version: version ?? prev.version,
      uptime: uptime ?? prev.uptime,
      lastCheckAt: new Date(lastCheckTimestamp),
      connections: {
        ...prev.connections,
        openClaw: status.status.running ? 'connected' : 'disconnected',
      },
    }))
    setCliStatus({
      available: status.cliAvailable,
      version: status.cliVersion,
      minVersion: status.minVersion,
      belowMinVersion: status.belowMinVersion,
      error: status.cliError,
    })
    setLocalOnly(status.localOnly ?? null)
  }, [])

  const refreshStatus = useCallback(async () => {
    try {
      const statusResult = await maintenanceApi.getStatus()
      applyMaintenanceStatus(statusResult.data)
    } catch (err) {
      console.error('Failed to refresh maintenance status:', err)
    }
  }, [applyMaintenanceStatus])

  const refreshErrors = useCallback(async () => {
    setErrorSummaryLoading(true)
    setErrorSignaturesLoading(true)
    try {
      const [summaryResult, signaturesResult] = await Promise.all([
        maintenanceApi.getErrorSummary(14),
        maintenanceApi.listErrorSignatures({
          days: 14,
          limit: 20,
          includeRaw: includeRawEvidence,
        }),
      ])

      setErrorSummary(summaryResult.data)
      setErrorSignatures(signaturesResult.data.signatures)

      if (
        selectedErrorHash
        && !signaturesResult.data.signatures.some((sig) => sig.signatureHash === selectedErrorHash)
      ) {
        setSelectedErrorHash(null)
      }
    } catch (err) {
      console.error('Failed to load error summary:', err)
    } finally {
      setErrorSummaryLoading(false)
      setErrorSignaturesLoading(false)
    }
  }, [includeRawEvidence, selectedErrorHash])

  useEffect(() => {
    refreshStatus()
    refreshErrors()
  }, [refreshStatus, refreshErrors])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setRelativeNowMs(Date.now())
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    if (!errorSignatures.some((signature) => signature.insight?.status === 'pending')) return

    const timeoutId = window.setTimeout(() => {
      void refreshErrors()
    }, 6000)

    return () => window.clearTimeout(timeoutId)
  }, [errorSignatures, refreshErrors])

  useEffect(() => {
    if (!selectedErrorHash) return
    setDrawerIncludeRawEvidence(false)
  }, [selectedErrorHash])

  useEffect(() => {
    if (!drawerIncludeRawEvidence || !selectedErrorSignature) return
    if (selectedErrorSignature.rawRedactedSample) return
    if (drawerRawEvidenceByHash[selectedErrorSignature.signatureHash]) return

    let cancelled = false
    setDrawerRawEvidenceLoading(true)

    void maintenanceApi.listErrorSignatures({
      days: 14,
      limit: 20,
      includeRaw: true,
    }).then((result) => {
      if (cancelled) return

      const match = result.data.signatures.find((signature) => signature.signatureHash === selectedErrorSignature.signatureHash)
      if (!match?.rawRedactedSample) return

      setDrawerRawEvidenceByHash((prev) => ({
        ...prev,
        [match.signatureHash]: match.rawRedactedSample as string,
      }))
    }).catch((err) => {
      if (!cancelled) {
        console.error('Failed to load raw evidence for signature:', err)
      }
    }).finally(() => {
      if (!cancelled) {
        setDrawerRawEvidenceLoading(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [drawerIncludeRawEvidence, drawerRawEvidenceByHash, selectedErrorSignature])

  // Handle playbook click - open in drawer
  const handlePlaybookClick = useCallback(async (id: string) => {
    setIsLoading(true)
    setError(null)

    try {
      const result = await playbooksApi.get(id)
      setSelectedPlaybook(result.data)
      setPlaybookContent(result.data.content)
    } catch (err) {
      console.error('Failed to load playbook:', err)
      setError(err instanceof Error ? err.message : 'Failed to load playbook')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Handle save with Governor gating
  const handleSave = useCallback(async (content: string): Promise<void> => {
    if (!selectedPlaybook) return

    return new Promise((resolve, reject) => {
      protectedAction.trigger({
        actionKind: 'action.caution',
        actionTitle: 'Edit Playbook',
        actionDescription: `You are editing the "${selectedPlaybook.name}" playbook. Changes will take effect immediately.`,
        onConfirm: async (typedConfirmText) => {
          setIsSaving(true)
          setError(null)

          try {
            const result = await playbooksApi.update(selectedPlaybook.id, {
              content,
              typedConfirmText,
            })
            setSelectedPlaybook(result.data)
            setPlaybookContent(content)
            // Update the list
            setPlaybooks((prev) =>
              prev.map((p) =>
                p.id === selectedPlaybook.id
                  ? { ...p, modifiedAt: result.data.modifiedAt }
                  : p
              )
            )
            resolve()
          } catch (err) {
            console.error('Failed to save playbook:', err)
            if (err instanceof HttpError) {
              setError(err.message)
            }
            reject(err)
          } finally {
            setIsSaving(false)
          }
        },
        onError: (err) => {
          setError(err.message)
          reject(err)
        },
      })
    })
  }, [selectedPlaybook, protectedAction])

  // Handle maintenance action
  const handleAction = useCallback((action: MaintenanceAction) => {
    const config = ACTION_CONFIG[action]
    setLastResult(null)

    protectedAction.trigger({
      actionKind: config.actionKind,
      actionTitle: config.title,
      actionDescription: config.description,
      onConfirm: async (typedConfirmText) => {
        setRunningAction(action)
        setError(null)

        try {
          if (action === 'recover') {
            const result = await maintenanceApi.recover(typedConfirmText)
            const success = result.data.finalStatus === 'healthy' || result.data.finalStatus === 'recovered'
            setLastResult({
              action,
              success,
              message: success
                ? 'Gateway recovered successfully'
                : result.data.finalStatus === 'needs_manual_intervention'
                  ? 'Recovery incomplete - manual intervention required'
                  : 'Recovery failed',
              receiptId: result.receiptId,
            })

            // Refresh gateway status after recovery
            if (success) {
              await refreshStatus()
            }
          } else if (action === 'greenfield-reset') {
            const result = await maintenanceApi.greenfieldReset(typedConfirmText)
            setLastResult({
              action,
              success: true,
              message: `Greenfield reset complete (teams ${result.data.teamsDeleted}, agents ${result.data.agentsDeleted})`,
              receiptId: result.receiptId,
            })
            await refreshStatus()
          } else {
            const result = await maintenanceApi.runAction(action, typedConfirmText)
            const success = result.data.exitCode === 0
            setLastResult({
              action,
              success,
              message: success
                ? `${config.title} completed successfully`
                : `${config.title} failed (exit code: ${result.data.exitCode})`,
              receiptId: result.data.receiptId,
            })

            // Refresh gateway status after health check
            if (action === 'health' && success && result.data.parsedJson) {
              const healthData = result.data.parsedJson as { status?: string }
              setGateway((prev) => ({
                ...prev,
                status: (healthData.status as 'ok' | 'degraded' | 'down') || prev.status,
                lastCheckAt: new Date(),
              }))
            }
          }
        } catch (err) {
          console.error(`Failed to run ${action}:`, err)
          setError(err instanceof Error ? err.message : `Failed to run ${action}`)
          setLastResult({
            action,
            success: false,
            message: err instanceof Error ? err.message : 'Action failed',
          })
        } finally {
          setRunningAction(null)
        }
      },
      onError: (err) => {
        console.error(`Action ${action} error:`, err)
        setError(err.message)
        setRunningAction(null)
      },
    })
  }, [gateway, protectedAction, refreshStatus])

  // Handle playbook run
  const handleRunPlaybook = useCallback((playbook: { id: string; name: string; severity: 'info' | 'warn' | 'critical' }) => {
    setLastResult(null)

    const actionKind = playbook.severity === 'critical' ? 'action.danger' : 'action.caution'

    protectedAction.trigger({
      actionKind,
      actionTitle: `Run Playbook: ${playbook.name}`,
      actionDescription: `Execute the "${playbook.name}" playbook. This will run all steps defined in the playbook.`,
      onConfirm: async (typedConfirmText) => {
        setRunningPlaybookId(playbook.id)
        setError(null)

        try {
          const result = await playbooksApi.run(playbook.id, { typedConfirmText })
          const success = result.data.status === 'completed'
          setLastResult({
            action: 'playbook',
            success,
            message: success
              ? `Playbook "${playbook.name}" completed successfully (${result.data.steps.length} steps)`
              : `Playbook "${playbook.name}" failed`,
            receiptId: result.receiptId,
            playbookResult: result.data,
          })
        } catch (err) {
          console.error(`Failed to run playbook ${playbook.id}:`, err)
          setError(err instanceof Error ? err.message : 'Failed to run playbook')
          setLastResult({
            action: 'playbook',
            success: false,
            message: err instanceof Error ? err.message : 'Playbook execution failed',
          })
        } finally {
          setRunningPlaybookId(null)
        }
      },
      onError: (err) => {
        console.error(`Playbook ${playbook.id} error:`, err)
        setError(err.message)
        setRunningPlaybookId(null)
      },
    })
  }, [protectedAction])

  const runSuggestedMaintenanceAction = useCallback((signature: MaintenanceErrorSignature) => {
    const suggestedAction = signature.classification.suggestedActions.find(
      (action) => action.kind === 'maintenance' && typeof action.maintenanceAction === 'string'
    )

    if (!suggestedAction?.maintenanceAction) return

    const maintenanceAction = suggestedAction.maintenanceAction as MaintenanceAction
    if (!(maintenanceAction in ACTION_CONFIG)) return

    handleAction(maintenanceAction)
  }, [handleAction])

  const remediateError = useCallback(async (
    signatureHash: string,
    mode: 'create' | 'create_and_start'
  ) => {
    setRemediationState({ signatureHash, mode })
    setErrorWorkflowResult(null)

    try {
      const response = await maintenanceApi.remediateError(signatureHash, { mode })
      const result = response.data
      const success = mode === 'create' ? true : result.started

      setErrorWorkflowResult({
        signatureHash,
        success,
        message: mode === 'create'
          ? `Work order ${result.code} created`
          : result.started
            ? `Work order ${result.code} created and started`
            : `Work order ${result.code} created, start failed: ${result.startError ?? 'unknown error'}`,
        workOrderId: result.workOrderId,
        code: result.code,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create remediation work order'
      setErrorWorkflowResult({
        signatureHash,
        success: false,
        message,
        workOrderId: '',
        code: '',
      })
    } finally {
      setRemediationState(null)
    }
  }, [])

  const cliVersionLabel = cliStatus?.version ?? 'unknown'
  const showCliTooOld = cliStatus?.available && cliStatus.belowMinVersion
  const showCliUnknown = cliStatus?.available && !cliStatus.belowMinVersion && cliVersionLabel === 'unknown'
  const blockCriticalActions = cliStatus?.belowMinVersion === true

  const localOnlyEnabled = localOnly?.clawcontrol?.enforced === true
  const openclawLocalOk = localOnly?.openclawDashboard?.ok !== false

  return (
    <>
      <div className="w-full space-y-6">
        <PageHeader
          title="Maintenance"
          subtitle="Gateway console and system tools"
        />

        {(showCliTooOld || showCliUnknown) && (
          <div className="p-3 rounded-md border flex items-start gap-2 bg-status-warning/10 border-status-warning/30">
            <AlertTriangle className="w-4 h-4 text-status-warning shrink-0 mt-0.5" />
            <div className="text-sm text-status-warning">
              {showCliTooOld ? (
                <>OpenClaw version too old: {cliVersionLabel} (min: {cliStatus?.minVersion}). Some commands may fail.</>
              ) : (
                <>OpenClaw version unknown (min: {cliStatus?.minVersion}). Some commands may fail.</>
              )}
            </div>
          </div>
        )}

        {/* Last Result Banner */}
        {lastResult && (
          <div className={cn(
            'p-3 rounded-md border flex items-center justify-between',
            lastResult.success
              ? 'bg-status-success/10 border-status-success/30'
              : 'bg-status-error/10 border-status-error/30'
          )}>
            <div className="flex items-center gap-2">
              {lastResult.success ? (
                <CheckCircle className="w-4 h-4 text-status-success shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-status-error shrink-0" />
              )}
              <span className={cn(
                'text-sm',
                lastResult.success ? 'text-status-success' : 'text-status-error'
              )}>
                {lastResult.message}
              </span>
            </div>
            {lastResult.receiptId && (
              <span className="text-xs text-fg-2 font-mono">
                Receipt: {lastResult.receiptId}
              </span>
            )}
          </div>
        )}

        {/* Gateway Status */}
        <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-fg-0">Gateway Status</h2>
            <div className="flex items-center gap-2">
              <StatusPill
                tone={localOnlyEnabled && openclawLocalOk ? 'success' : 'warning'}
                label={localOnlyEnabled && openclawLocalOk ? 'LOCAL-ONLY: ENABLED' : 'LOCAL-ONLY: UNSAFE'}
              />
              <StatusPill
                tone={gateway.status === 'ok' ? 'success' : gateway.status === 'degraded' ? 'warning' : 'danger'}
                label={gateway.status.toUpperCase()}
              />
              <Button
                onClick={() => void refreshStatus()}
                disabled={runningAction !== null || isLoading}
                variant="secondary"
                size="xs"
              >
                {runningAction === 'health' ? (
                  <LoadingSpinner size="xs" />
                ) : (
                  <RefreshCw className="w-3 h-3" />
                )}
                Refresh Status
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatusCard
              label="Latency"
              value={`${gateway.latencyMs}ms`}
              icon={RefreshCw}
            />
            <StatusCard
              label="Version"
              value={gateway.version}
              icon={Server}
            />
            <StatusCard
              label="Uptime"
              value={formatUptime(gateway.uptime)}
              icon={Play}
            />
            <StatusCard
              label="Last Check"
              value={formatRelativeTime(gateway.lastCheckAt, relativeNowMs)}
              icon={RefreshCw}
            />
          </div>

          {/* Connections */}
          <div className="pt-4 border-t border-bd-0">
            <h3 className="text-xs font-medium text-fg-2 mb-3">Connections</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <ConnectionCard
                label="OpenClaw"
                status={gateway.connections.openClaw}
                icon={Server}
              />
              <ConnectionCard
                label="Database"
                status={gateway.connections.database}
                icon={Database}
              />
              <ConnectionCard
                label="Redis"
                status={gateway.connections.redis}
                icon={Wifi}
              />
            </div>
          </div>
        </div>

        {/* Maintenance Actions */}
        <PageSection title="Actions" description="System maintenance operations">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <LiveActionCard
              action="health"
              config={ACTION_CONFIG['health']}
              isRunning={runningAction === 'health'}
              disabled={runningAction !== null}
              onClick={() => handleAction('health')}
            />
            <LiveActionCard
              action="doctor"
              config={ACTION_CONFIG['doctor']}
              isRunning={runningAction === 'doctor'}
              disabled={runningAction !== null}
              onClick={() => handleAction('doctor')}
            />
          </div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-3">
            <LiveActionCard
              action="doctor-fix"
              config={ACTION_CONFIG['doctor-fix']}
              isRunning={runningAction === 'doctor-fix'}
              disabled={runningAction !== null || blockCriticalActions}
              onClick={() => handleAction('doctor-fix')}
              danger
            />
            <LiveActionCard
              action="cache-clear"
              config={ACTION_CONFIG['cache-clear']}
              isRunning={runningAction === 'cache-clear'}
              disabled={runningAction !== null}
              onClick={() => handleAction('cache-clear')}
              danger
            />
            <LiveActionCard
              action="sessions-reset"
              config={ACTION_CONFIG['sessions-reset']}
              isRunning={runningAction === 'sessions-reset'}
              disabled={runningAction !== null}
              onClick={() => handleAction('sessions-reset')}
              danger
            />
            <LiveActionCard
              action="greenfield-reset"
              config={ACTION_CONFIG['greenfield-reset']}
              isRunning={runningAction === 'greenfield-reset'}
              disabled={runningAction !== null || blockCriticalActions}
              onClick={() => handleAction('greenfield-reset')}
              danger
            />
          </div>
        </PageSection>

        {/* Recovery */}
        <PageSection title="Recovery" description="One-click gateway recovery playbook">
          <div className="p-4 bg-bg-3 rounded-[var(--radius-lg)] border border-bd-0">
            <div className="flex items-start gap-4">
              <div className="p-2 bg-status-warning/10 rounded-lg">
                <Wrench className="w-6 h-6 text-status-warning" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-medium text-fg-0">Recover Gateway</h3>
                <p className="text-xs text-fg-2 mt-1">
                  Runs the full recovery playbook: health check → diagnostics → auto-fix → restart → verify.
                  Use this when the gateway is unhealthy or unresponsive.
                </p>
                {blockCriticalActions && (
                  <p className="text-xs text-status-warning mt-2">
                    Requires OpenClaw {cliStatus?.minVersion} or newer.
                  </p>
                )}
              </div>
              <Button
                onClick={() => handleAction('recover')}
                disabled={runningAction !== null || blockCriticalActions}
                variant="primary"
                size="sm"
                className="self-center"
              >
                {runningAction === 'recover' ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <Wrench className="w-3.5 h-3.5" />
                )}
                Run Recovery
              </Button>
            </div>
          </div>
        </PageSection>

        {/* Playbooks */}
        {playbooks.length > 0 && (
          <PageSection title="Playbooks" description="Automated maintenance procedures">
            <div className="space-y-2">
              {playbooks.map((playbook) => (
                <PlaybookCard
                  key={playbook.id}
                  id={playbook.id}
                  name={playbook.name}
                  description={playbook.description}
                  severity={playbook.severity}
                  modifiedAt={playbook.modifiedAt}
                  onEdit={() => handlePlaybookClick(playbook.id)}
                  onRun={() => handleRunPlaybook(playbook)}
                  isRunning={runningPlaybookId === playbook.id}
                />
              ))}
            </div>
          </PageSection>
        )}

        <PageSection title="Error Dashboard" description="Gateway error signatures and trend">
          <div className="p-4 bg-bg-3 rounded-[var(--radius-lg)] border border-bd-0 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-fg-0">Error trend (14 days)</h3>
                {errorSummary?.spike.detected ? (
                  <span className="px-2 py-0.5 text-xs rounded bg-status-danger/[0.15] text-status-danger">
                    Spike detected
                  </span>
                ) : (
                  <span className="px-2 py-0.5 text-xs rounded bg-status-success/[0.15] text-status-success">
                    Stable
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => setIncludeRawEvidence(false)}
                  variant={includeRawEvidence ? 'secondary' : 'primary'}
                  size="xs"
                >
                  Sanitized
                </Button>
                <Button
                  onClick={() => setIncludeRawEvidence(true)}
                  variant={includeRawEvidence ? 'primary' : 'secondary'}
                  size="xs"
                >
                  Raw (Redacted)
                </Button>
                <Button
                  onClick={refreshErrors}
                  disabled={errorSummaryLoading || errorSignaturesLoading}
                  variant="secondary"
                  size="xs"
                >
                  {(errorSummaryLoading || errorSignaturesLoading) ? <LoadingSpinner size="xs" /> : <RefreshCw className="w-3 h-3" />}
                  Refresh
                </Button>
              </div>
            </div>

            {!errorSummary || errorSummary.trend.length === 0 ? (
              <div className="text-xs text-fg-2">No error events ingested yet.</div>
            ) : (
              <div className="space-y-4">
                <div className="h-24 flex items-end gap-1">
                  {(() => {
                    const max = Math.max(...errorSummary.trend.map((item) => Number(item.count)), 1)
                    return errorSummary.trend.map((item) => {
                      const value = Number(item.count)
                      const height = Math.max(4, (value / max) * 100)
                      const isToday = item.day === errorSummary.trend[errorSummary.trend.length - 1]?.day
                      const isYesterday = item.day === errorSummary.trend[errorSummary.trend.length - 2]?.day
                      return (
                        <div
                          key={item.day}
                          className={cn(
                            'flex-1 hover:bg-status-danger/40 rounded-t',
                            isYesterday
                              ? 'bg-status-danger/45'
                              : isToday
                                ? 'bg-status-warning/35'
                                : 'bg-status-danger/25'
                          )}
                          style={{ height: `${height}%` }}
                          title={`${new Date(item.day).toLocaleDateString()} · ${item.count}`}
                        />
                      )
                    })
                  })()}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div className="p-2 rounded border border-bd-0 bg-bg-2/60">
                    <div className="text-fg-2">Total errors (14d)</div>
                    <div className="font-mono text-fg-0">{errorSummary.totals.totalErrors}</div>
                  </div>
                  <div className="p-2 rounded border border-bd-0 bg-bg-2/60">
                    <div className="text-fg-2">Unique signatures</div>
                    <div className="font-mono text-fg-0">{errorSummary.totals.windowUniqueSignatures}</div>
                  </div>
                  <div className="p-2 rounded border border-bd-0 bg-bg-2/60">
                    <div className="text-fg-2">Yesterday</div>
                    <div className="font-mono text-fg-0">{errorSummary.spike.yesterdayCount}</div>
                  </div>
                  <div className="p-2 rounded border border-bd-0 bg-bg-2/60">
                    <div className="text-fg-2">7-day baseline</div>
                    <div className="font-mono text-fg-0">{errorSummary.spike.baseline}</div>
                  </div>
                </div>

                {errorWorkflowResult && (
                  <div className={cn(
                    'p-3 rounded-md border flex items-start gap-2',
                    errorWorkflowResult.success
                      ? 'bg-status-success/10 border-status-success/30'
                      : 'bg-status-danger/10 border-status-danger/30'
                  )}>
                    {errorWorkflowResult.success ? (
                      <CheckCircle className="w-4 h-4 text-status-success shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="w-4 h-4 text-status-danger shrink-0 mt-0.5" />
                    )}
                    <div className="text-xs">
                      <div className={cn(errorWorkflowResult.success ? 'text-status-success' : 'text-status-danger')}>
                        {errorWorkflowResult.message}
                      </div>
                      {errorWorkflowResult.workOrderId ? (
                        <div className="text-fg-2 mt-1 font-mono">
                          {errorWorkflowResult.code} · {errorWorkflowResult.workOrderId}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}

                {errorSignaturesLoading ? (
                  <div className="py-5 flex items-center gap-2 text-xs text-fg-2">
                    <LoadingSpinner size="sm" />
                    Loading signatures...
                  </div>
                ) : errorSignatures.length === 0 ? (
                  <div className="text-xs text-fg-2">No ranked signatures found for this time window.</div>
                ) : (
                  <div className="space-y-2">
                    {errorSignatures.map((signature) => {
                      const hasMaintenanceSuggestion = signature.classification.suggestedActions.some(
                        (action) => action.kind === 'maintenance' && typeof action.maintenanceAction === 'string'
                      )
                      const commandSuggestion = signature.classification.suggestedActions.find(
                        (action) => action.kind !== 'maintenance' && typeof action.command === 'string'
                      )?.command ?? signature.classification.extractedCliCommand
                      const evidenceText = [
                        signature.signatureText,
                        '',
                        includeRawEvidence
                          ? (signature.rawRedactedSample ?? signature.sample)
                          : signature.sample,
                      ].join('\n')

                      const isCreating = remediationState?.signatureHash === signature.signatureHash && remediationState.mode === 'create'
                      const isCreatingAndStarting = remediationState?.signatureHash === signature.signatureHash && remediationState.mode === 'create_and_start'

                      return (
                        <button
                          key={signature.signatureHash}
                          type="button"
                          onClick={() => setSelectedErrorHash(signature.signatureHash)}
                          className={cn(
                            'w-full text-left p-3 rounded-md border transition-colors',
                            selectedErrorHash === signature.signatureHash
                              ? 'bg-bg-2 border-bd-1'
                              : 'bg-bg-2/60 border-bd-0 hover:bg-bg-2'
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-xs text-fg-2">{signature.windowCount}</span>
                                <span className="text-xs text-fg-0">{signature.classification.title}</span>
                                <span className="px-1.5 py-0.5 text-[10px] rounded bg-bg-3 text-fg-2 uppercase">
                                  {signature.classification.category.replace('_', ' ')}
                                </span>
                                <span className={cn(
                                  'px-1.5 py-0.5 text-[10px] rounded uppercase',
                                  signature.classification.severity === 'critical' && 'bg-status-danger/20 text-status-danger',
                                  signature.classification.severity === 'high' && 'bg-status-warning/20 text-status-warning',
                                  signature.classification.severity === 'medium' && 'bg-status-info/20 text-status-info',
                                  signature.classification.severity === 'low' && 'bg-bg-3 text-fg-2'
                                )}>
                                  {signature.classification.severity}
                                </span>
                                <span className="text-[10px] text-fg-3">
                                  {Math.round(signature.classification.confidence * 100)}% confidence
                                </span>
                              </div>
                              <div className="text-xs text-fg-2 truncate mt-1" title={signature.signatureText}>
                                {signature.signatureText}
                              </div>
                              <div className="text-[11px] text-fg-3 mt-1">
                                Last seen {formatRelativeTime(signature.lastSeen, relativeNowMs)} · all-time {signature.allTimeCount}
                              </div>
                            </div>

                            <div className="flex flex-col items-end gap-1.5 shrink-0" onClick={(event) => event.stopPropagation()}>
                              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                                <Button
                                  size="xs"
                                  variant="primary"
                                  disabled={!!remediationState}
                                  onClick={() => void remediateError(signature.signatureHash, 'create')}
                                >
                                  {isCreating ? <LoadingSpinner size="xs" /> : null}
                                  Create Work Order
                                </Button>
                                <Button
                                  size="xs"
                                  variant="secondary"
                                  disabled={!!remediationState}
                                  onClick={() => void remediateError(signature.signatureHash, 'create_and_start')}
                                >
                                  {isCreatingAndStarting ? <LoadingSpinner size="xs" /> : null}
                                  Create + Start
                                </Button>
                                <CopyButton text={evidenceText} className="h-[26px]" />
                              </div>

                              {hasMaintenanceSuggestion ? (
                                <div className="flex items-center gap-1.5">
                                  <Button
                                    size="xs"
                                    variant="secondary"
                                    disabled={runningAction !== null}
                                    onClick={() => runSuggestedMaintenanceAction(signature)}
                                  >
                                    Run Suggested Fix
                                  </Button>
                                </div>
                              ) : commandSuggestion ? (
                                <div className="flex items-center gap-1.5">
                                  <CopyButton text={commandSuggestion} className="h-[26px]" />
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </PageSection>

        <RightDrawer
          open={!!selectedErrorSignature}
          onClose={() => setSelectedErrorHash(null)}
          title={selectedErrorSignature ? `Error ${selectedErrorSignature.signatureHash.slice(0, 10)}` : ''}
          description="Actionable signature details and remediation guidance"
          width="lg"
        >
          {selectedErrorSignature ? (
            <div className="space-y-5">
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs px-1.5 py-0.5 rounded bg-bg-2 text-fg-2 uppercase">
                    {selectedErrorSignature.classification.category.replace('_', ' ')}
                  </span>
                  <span className="text-xs text-fg-2">
                    Detectability: {selectedErrorSignature.classification.detectability}
                  </span>
                  <span className="text-xs text-fg-2">
                    Confidence: {Math.round(selectedErrorSignature.classification.confidence * 100)}%
                  </span>
                </div>
                <h4 className="text-sm font-medium text-fg-0">
                  {selectedErrorSignature.classification.title}
                </h4>
                <p className="text-xs text-fg-2">
                  {selectedErrorSignature.classification.explanation}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-2 rounded border border-bd-0 bg-bg-2/70">
                  <div className="text-fg-2">Window count</div>
                  <div className="font-mono text-fg-0">{selectedErrorSignature.windowCount}</div>
                </div>
                <div className="p-2 rounded border border-bd-0 bg-bg-2/70">
                  <div className="text-fg-2">All-time count</div>
                  <div className="font-mono text-fg-0">{selectedErrorSignature.allTimeCount}</div>
                </div>
                <div className="p-2 rounded border border-bd-0 bg-bg-2/70">
                  <div className="text-fg-2">First seen</div>
                  <div className="text-fg-0">{new Date(selectedErrorSignature.firstSeen).toLocaleString()}</div>
                </div>
                <div className="p-2 rounded border border-bd-0 bg-bg-2/70">
                  <div className="text-fg-2">Last seen</div>
                  <div className="text-fg-0">{new Date(selectedErrorSignature.lastSeen).toLocaleString()}</div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h5 className="text-xs font-medium text-fg-1 uppercase tracking-wide">AI remediation insight</h5>
                  <Bot className="w-3.5 h-3.5 text-fg-2" />
                </div>
                {selectedErrorSignature.insight?.status === 'ready' && selectedErrorSignature.insight.diagnosisMd ? (
                  <div className="p-3 rounded border border-bd-0 bg-bg-2/70 text-xs text-fg-1 whitespace-pre-wrap">
                    {selectedErrorSignature.insight.diagnosisMd}
                  </div>
                ) : selectedErrorSignature.insight?.status === 'pending' ? (
                  <div className="p-3 rounded border border-bd-0 bg-bg-2/70 text-xs text-fg-2 flex items-center gap-2">
                    <LoadingSpinner size="xs" />
                    Insight generation in progress...
                  </div>
                ) : (
                  <div className="p-3 rounded border border-bd-0 bg-bg-2/70 text-xs text-fg-2">
                    {selectedErrorSignature.insight?.failureReason
                      ? `Insight generation failed: ${selectedErrorSignature.insight.failureReason}`
                      : 'Insight not available yet. Deterministic remediation suggestions are still available below.'}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h5 className="text-xs font-medium text-fg-1 uppercase tracking-wide">Evidence</h5>
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => setDrawerIncludeRawEvidence(false)}
                      size="xs"
                      variant={drawerIncludeRawEvidence ? 'secondary' : 'primary'}
                    >
                      Sanitized
                    </Button>
                    <Button
                      onClick={() => setDrawerIncludeRawEvidence(true)}
                      size="xs"
                      variant={drawerIncludeRawEvidence ? 'primary' : 'secondary'}
                    >
                      Raw (Redacted)
                    </Button>
                    <CopyButton
                      text={selectedEvidenceText}
                      className="h-[26px]"
                    />
                  </div>
                </div>
                {drawerIncludeRawEvidence && drawerRawEvidenceLoading && !selectedRawEvidence ? (
                  <div className="text-[11px] text-fg-3">Loading raw redacted evidence...</div>
                ) : null}
                <pre className="p-3 rounded border border-bd-0 bg-bg-2/70 text-xs text-fg-1 whitespace-pre-wrap break-words">
                  {selectedEvidenceText}
                </pre>
              </div>

              <div className="space-y-2">
                <h5 className="text-xs font-medium text-fg-1 uppercase tracking-wide">Suggested actions</h5>
                <div className="space-y-2">
                  {selectedErrorSignature.classification.suggestedActions.map((action) => (
                    <div key={action.id} className="p-2 rounded border border-bd-0 bg-bg-2/70 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-fg-0">{action.label}</div>
                        {action.kind === 'maintenance' && action.maintenanceAction ? (
                          <Button
                            size="xs"
                            variant="secondary"
                            disabled={runningAction !== null}
                            onClick={() => {
                              const maintenanceAction = action.maintenanceAction as MaintenanceAction
                              if (maintenanceAction in ACTION_CONFIG) {
                                handleAction(maintenanceAction)
                              }
                            }}
                          >
                            Run Suggested Fix
                          </Button>
                        ) : action.command ? (
                          <CopyButton text={action.command} className="h-[26px]" />
                        ) : null}
                      </div>
                      <div className="text-fg-2 mt-1">{action.description}</div>
                      {action.command ? (
                        <div className="text-[11px] text-fg-3 mt-1 font-mono break-all">{action.command}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </RightDrawer>
      </div>

      {/* Playbook Editor Drawer */}
      <RightDrawer
        open={!!selectedPlaybook}
        onClose={() => {
          setSelectedPlaybook(null)
          setError(null)
        }}
        title={selectedPlaybook?.name ?? ''}
        description="YAML playbook configuration"
        width="lg"
      >
        {isLoading ? (
          <LoadingState />
        ) : selectedPlaybook ? (
          <YamlEditor
            value={playbookContent}
            onChange={setPlaybookContent}
            onSave={handleSave}
            filePath={`playbooks/${selectedPlaybook.name}.yaml`}
            isSaving={isSaving}
            error={error}
            height="calc(100vh - 200px)"
          />
        ) : null}
      </RightDrawer>

      {/* Confirm Modal */}
      <TypedConfirmModal
        isOpen={protectedAction.state.isOpen}
        onClose={protectedAction.cancel}
        onConfirm={protectedAction.confirm}
        actionTitle={protectedAction.state.actionTitle}
        actionDescription={protectedAction.state.actionDescription}
        confirmMode={protectedAction.confirmMode}
        riskLevel={protectedAction.riskLevel}
        workOrderCode={protectedAction.state.workOrderCode}
        entityName={protectedAction.state.entityName}
        isLoading={protectedAction.state.isLoading}
      />
    </>
  )
}

function StatusCard({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="p-3 bg-bg-3 rounded-[var(--radius-md)] border border-bd-0">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-3.5 h-3.5 text-fg-2" />
        <span className="text-xs text-fg-2">{label}</span>
      </div>
      <span className="font-mono text-sm text-fg-0">{value}</span>
    </div>
  )
}

function ConnectionCard({
  label,
  status,
  icon: Icon,
}: {
  label: string
  status: 'connected' | 'disconnected' | 'error'
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="flex items-center justify-between p-3 bg-bg-3 rounded-[var(--radius-md)] border border-bd-0">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-fg-2" />
        <span className="text-sm text-fg-1">{label}</span>
      </div>
      <span className={cn(
        'w-2 h-2 rounded-full',
        status === 'connected' && 'bg-status-success',
        status === 'disconnected' && 'bg-fg-3',
        status === 'error' && 'bg-status-danger'
      )} />
    </div>
  )
}

function LiveActionCard({
  action: _action,
  config,
  isRunning,
  disabled,
  danger,
  onClick,
}: {
  action: MaintenanceAction
  config: typeof ACTION_CONFIG[MaintenanceAction]
  isRunning: boolean
  disabled: boolean
  danger?: boolean
  onClick: () => void
}) {
  const Icon = config.icon

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-start gap-3 p-4 rounded-[var(--radius-lg)] border text-left transition-colors',
        disabled && !isRunning
          ? 'bg-bg-3/50 border-bd-0/50 cursor-not-allowed opacity-60'
          : danger
            ? 'bg-bg-3 border-bd-0 hover:bg-status-error/10 hover:border-status-error/30'
            : 'bg-bg-3 border-bd-0 hover:bg-bg-2 hover:border-bd-1'
      )}
    >
      {isRunning ? (
        <LoadingSpinner size="lg" className="text-accent-primary shrink-0 mt-0.5" />
      ) : (
        <Icon className={cn(
          'w-5 h-5 shrink-0 mt-0.5',
          danger ? 'text-status-error' : 'text-fg-2'
        )} />
      )}
      <div>
        <h3 className={cn(
          'text-sm font-medium',
          danger ? 'text-status-error' : 'text-fg-0'
        )}>
          {config.title}
        </h3>
        <p className="text-xs text-fg-2 mt-0.5">{config.description}</p>
      </div>
    </button>
  )
}

function PlaybookCard({
  name,
  description,
  severity,
  modifiedAt,
  onEdit,
  onRun,
  isRunning,
}: {
  id: string
  name: string
  description: string
  severity: 'info' | 'warn' | 'critical'
  modifiedAt: Date
  onEdit: () => void
  onRun: () => void
  isRunning: boolean
}) {
  const severityColors = {
    info: 'bg-status-info/10 text-status-info',
    warn: 'bg-status-warning/10 text-status-warning',
    critical: 'bg-status-danger/10 text-status-danger',
  }

  return (
    <div className="flex items-center justify-between p-3 bg-bg-3 rounded-[var(--radius-md)] border border-bd-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <FileCode className="w-4 h-4 text-fg-2 shrink-0" />
          <span className="font-mono text-sm text-fg-0">{name}</span>
          <span className={cn(
            'px-1.5 py-0.5 text-xs rounded',
            severityColors[severity]
          )}>
            {severity}
          </span>
        </div>
        <p className="text-xs text-fg-2 mt-0.5 ml-6">{description}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-4">
        <span className="text-xs text-fg-3">{formatRelativeTime(modifiedAt)}</span>
        <button
          onClick={onEdit}
          className="p-1.5 hover:bg-bg-2 rounded-[var(--radius-sm)] transition-colors"
          title="Edit playbook"
        >
          <Edit3 className="w-3.5 h-3.5 text-fg-2" />
        </button>
        <button
          onClick={onRun}
          disabled={isRunning}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-[var(--radius-sm)] transition-colors',
            severity === 'critical'
              ? 'bg-status-danger/10 text-status-danger hover:bg-status-danger/20'
              : 'bg-status-success/10 text-status-success hover:bg-status-success/20',
            'disabled:opacity-50'
          )}
          title="Run playbook"
        >
          {isRunning ? (
            <LoadingSpinner size="xs" />
          ) : (
            <Play className="w-3 h-3" />
          )}
          Run
        </button>
      </div>
    </div>
  )
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  return `${days}d ${hours}h`
}

function formatRelativeTime(date: Date | string, nowMs = Date.now()): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const dateMs = d.getTime()
  if (!Number.isFinite(dateMs)) return 'unknown'

  const diff = Math.max(0, nowMs - dateMs)
  const secs = Math.floor(diff / 1000)
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (secs < 60) return `${secs}s ago`
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}
