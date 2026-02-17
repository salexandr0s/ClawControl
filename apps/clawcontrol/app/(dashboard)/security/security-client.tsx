'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { PageHeader, PageSection, TypedConfirmModal, Button } from '@clawcontrol/ui'
import { LoadingSpinner, LoadingState } from '@/components/ui/loading-state'
import {
  securityApi,
  workOrdersApi,
  type AuditReport,
  type AuditFinding,
  type FixResult,
  type FixAction,
  type AuditType,
  HttpError,
} from '@/lib/http'
import { useProtectedAction } from '@/lib/hooks/useProtectedAction'
import { useSettings } from '@/lib/settings-context'
import { cn } from '@/lib/utils'
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Info,
  XCircle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Play,
  Zap,
  Wrench,
  FileText,
  ExternalLink,
  Wifi,
  WifiOff,
  FileKey,
  ClipboardList,
} from 'lucide-react'

type AuditState = {
  isRunning: boolean
  auditType: AuditType | null
  report: AuditReport | null
  fixResult: FixResult | null
  error: string | null
  receiptId: string | null
}

type WorkOrderActionMode = 'create' | 'create_and_start'

export function SecurityClient() {
  const router = useRouter()
  const { skipTypedConfirm } = useSettings()
  const [state, setState] = useState<AuditState>({
    isRunning: false,
    auditType: null,
    report: null,
    fixResult: null,
    error: null,
    receiptId: null,
  })
  const [creatingWorkOrderMode, setCreatingWorkOrderMode] = useState<WorkOrderActionMode | null>(null)
  const [workOrderActionResult, setWorkOrderActionResult] = useState<{
    success: boolean
    message: string
    workOrderId: string
    code: string
  } | null>(null)

  const protectedAction = useProtectedAction({ skipTypedConfirm })

  const runAudit = useCallback((type: AuditType) => {
    // Fix mode requires confirmation
    if (type === 'fix') {
      protectedAction.trigger({
        actionKind: 'security.audit.fix',
        actionTitle: 'Apply Security Fixes',
        actionDescription: 'This will apply automatic security fixes including file permission changes. Review the findings first before applying fixes.',
        onConfirm: async (typedConfirmText) => {
          await executeAudit(type, typedConfirmText)
        },
        onError: (err) => {
          setState((prev) => ({ ...prev, error: err.message, isRunning: false }))
        },
      })
    } else {
      executeAudit(type)
    }
  }, [protectedAction])

  const executeAudit = async (type: AuditType, typedConfirmText?: string) => {
    setState((prev) => ({
      ...prev,
      isRunning: true,
      auditType: type,
      error: null,
    }))

    try {
      const result = await securityApi.runAudit(type, typedConfirmText)
      setState((prev) => ({
        ...prev,
        isRunning: false,
        report: result.data.report,
        fixResult: result.data.fix || null,
        receiptId: result.receiptId,
      }))
    } catch (err) {
      const message = err instanceof HttpError ? err.message : 'Audit failed'
      setState((prev) => ({
        ...prev,
        isRunning: false,
        error: message,
      }))
    }
  }

  const createWorkOrder = useCallback(async (mode: WorkOrderActionMode) => {
    if (!state.report) return

    setCreatingWorkOrderMode(mode)
    setWorkOrderActionResult(null)

    try {
      const { critical, warn, info } = state.report.summary
      const priority = critical > 0 ? 'P0' : warn > 0 ? 'P1' : 'P2'
      const title = `Security Remediation: ${critical} critical, ${warn} warnings`

      // Format findings for the work order description
      const formatFindings = (findings: AuditFinding[], severity: string) => {
        const filtered = findings.filter((f) => f.severity === severity)
        if (filtered.length === 0) return ''
        return `\n### ${severity.toUpperCase()} (${filtered.length})\n${filtered
          .map((f) => `- **${f.title}** (\`${f.checkId}\`)\n  ${f.detail.split('\n').join('\n  ')}`)
          .join('\n')}`
      }

      const goalMd = `## Security Audit Findings

**Summary:** ${critical} critical, ${warn} warnings, ${info} info

${formatFindings(state.report.findings, 'critical')}
${formatFindings(state.report.findings, 'warn')}
${formatFindings(state.report.findings, 'info')}

---

## Recommendations

Please review and address the security findings above. Focus on critical issues first, then warnings.

For automated fixes where available, run \`openclaw security audit --fix\`.
`

      const result = await workOrdersApi.create({
        title,
        goalMd,
        priority,
      })

      if (mode === 'create') {
        router.push(`/work-orders/${result.data.id}`)
        return
      }

      try {
        const started = await workOrdersApi.start(result.data.id)
        setWorkOrderActionResult({
          success: true,
          message: `Work order started successfully at stage ${started.stageIndex + 1}.`,
          workOrderId: result.data.id,
          code: result.data.code,
        })
      } catch (startErr) {
        const startMessage = startErr instanceof Error ? startErr.message : 'Failed to start work order'
        setWorkOrderActionResult({
          success: false,
          message: `Work order created, but start failed: ${startMessage}`,
          workOrderId: result.data.id,
          code: result.data.code,
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create work order'
      setState((prev) => ({ ...prev, error: message }))
    } finally {
      setCreatingWorkOrderMode(null)
    }
  }, [state.report, router])

  const { report, fixResult, isRunning, auditType, error, receiptId } = state

  return (
    <>
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <PageHeader
          title="Security"
          subtitle="Run security audits and review findings"
          actions={
            <div className="flex items-center gap-2">
              <Button
                onClick={() => runAudit('basic')}
                disabled={isRunning}
                variant="primary"
                size="sm"
              >
                {isRunning && auditType === 'basic' ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
                Run Audit
              </Button>

              <Button
                onClick={() => runAudit('deep')}
                disabled={isRunning}
                variant="secondary"
                size="sm"
              >
                {isRunning && auditType === 'deep' ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <Zap className="w-3.5 h-3.5" />
                )}
                Deep Audit
              </Button>

              <Button
                onClick={() => runAudit('fix')}
                disabled={isRunning || !report}
                title={!report ? 'Run an audit first to see what needs fixing' : undefined}
                variant="secondary"
                size="sm"
                className="text-status-warning border-status-warning/30 hover:bg-status-warning/10"
              >
                {isRunning && auditType === 'fix' ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <Wrench className="w-3.5 h-3.5" />
                )}
                Apply Fixes
              </Button>
            </div>
          }
        />

        {/* Error Banner */}
        {error && (
          <div className="p-3 rounded-md border flex items-center gap-2 bg-status-error/10 border-status-error/30">
            <XCircle className="w-4 h-4 text-status-error shrink-0" />
            <span className="text-sm text-status-error">{error}</span>
          </div>
        )}

        {workOrderActionResult && (
          <div className={cn(
            'p-3 rounded-md border flex items-start gap-2',
            workOrderActionResult.success
              ? 'bg-status-success/10 border-status-success/30'
              : 'bg-status-danger/10 border-status-danger/30'
          )}>
            {workOrderActionResult.success ? (
              <CheckCircle className="w-4 h-4 text-status-success shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-4 h-4 text-status-danger shrink-0 mt-0.5" />
            )}
            <div className="text-sm min-w-0">
              <div className={cn(
                workOrderActionResult.success ? 'text-status-success' : 'text-status-danger'
              )}>
                {workOrderActionResult.message}
              </div>
              <div className="mt-1 text-xs text-fg-2 font-mono">
                {workOrderActionResult.code} · {workOrderActionResult.workOrderId}
              </div>
              <button
                type="button"
                onClick={() => router.push(`/work-orders/${workOrderActionResult.workOrderId}`)}
                className="mt-1 text-xs text-status-info hover:underline"
              >
                Open work order
              </button>
            </div>
          </div>
        )}

        {/* Receipt ID */}
        {receiptId && (
          <div className="text-xs text-fg-3 font-mono">
            Receipt: {receiptId}
          </div>
        )}

        {/* Results */}
        {report && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <SeverityCard
                severity="critical"
                count={report.summary.critical}
                icon={ShieldAlert}
              />
              <SeverityCard
                severity="warn"
                count={report.summary.warn}
                icon={AlertTriangle}
              />
              <SeverityCard
                severity="info"
                count={report.summary.info}
                icon={Info}
              />
            </div>

            {/* Overall Status */}
            <div className={cn(
              'p-4 rounded-[var(--radius-lg)] border flex items-center gap-3',
              report.summary.critical > 0
                ? 'bg-status-error/10 border-status-error/30'
                : report.summary.warn > 0
                  ? 'bg-status-warning/10 border-status-warning/30'
                  : 'bg-status-success/10 border-status-success/30'
            )}>
              {report.summary.critical > 0 ? (
                <ShieldAlert className="w-8 h-8 text-status-error" />
              ) : report.summary.warn > 0 ? (
                <Shield className="w-8 h-8 text-status-warning" />
              ) : (
                <ShieldCheck className="w-8 h-8 text-status-success" />
              )}
              <div>
                <h3 className={cn(
                  'font-medium',
                  report.summary.critical > 0
                    ? 'text-status-error'
                    : report.summary.warn > 0
                      ? 'text-status-warning'
                      : 'text-status-success'
                )}>
                  {report.summary.critical > 0
                    ? 'Critical Issues Found'
                    : report.summary.warn > 0
                      ? 'Warnings Detected'
                      : 'Security Check Passed'}
                </h3>
                <p className="text-sm text-fg-2">
                  {report.findings.length} total findings from security audit
                </p>
              </div>
              <div className="ml-auto">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void createWorkOrder('create')}
                    disabled={creatingWorkOrderMode !== null || report.findings.length === 0}
                    className={cn(
                      'flex items-center gap-2 px-3 py-1.5 rounded-[var(--radius-sm)] text-sm font-medium transition-colors',
                      'bg-bg-3 border border-bd-0 text-fg-0 hover:bg-bg-2 hover:border-bd-1',
                      'disabled:opacity-50 disabled:cursor-not-allowed'
                    )}
                  >
                    {creatingWorkOrderMode === 'create' ? (
                      <LoadingSpinner size="sm" />
                    ) : (
                      <ClipboardList className="w-3.5 h-3.5" />
                    )}
                    Create Work Order
                  </button>
                  <button
                    onClick={() => void createWorkOrder('create_and_start')}
                    disabled={creatingWorkOrderMode !== null || report.findings.length === 0}
                    className={cn(
                      'flex items-center gap-2 px-3 py-1.5 rounded-[var(--radius-sm)] text-sm font-medium transition-colors',
                      'bg-status-info/10 border border-status-info/30 text-status-info hover:bg-status-info/20',
                      'disabled:opacity-50 disabled:cursor-not-allowed'
                    )}
                  >
                    {creatingWorkOrderMode === 'create_and_start' ? (
                      <LoadingSpinner size="sm" />
                    ) : (
                      <ClipboardList className="w-3.5 h-3.5" />
                    )}
                    Create + Start
                  </button>
                </div>
              </div>
            </div>

            {/* Deep Audit Gateway Status */}
            {report.deep && (
              <PageSection title="Gateway Probe" description="Deep audit connectivity check">
                <GatewayProbeCard deep={report.deep} />
              </PageSection>
            )}

            {/* Fix Actions */}
            {fixResult && (
              <PageSection title="Applied Fixes" description="Permission changes and config updates">
                <FixActionsPanel fixResult={fixResult} />
              </PageSection>
            )}

            {/* Findings by Severity */}
            <PageSection title="Findings" description="Security audit results grouped by severity">
              <div className="space-y-4">
                {['critical', 'warn', 'info'].map((severity) => {
                  const findings = report.findings.filter((f) => f.severity === severity)
                  if (findings.length === 0) return null
                  return (
                    <FindingsGroup
                      key={severity}
                      severity={severity as 'critical' | 'warn' | 'info'}
                      findings={findings}
                    />
                  )
                })}
                {report.findings.length === 0 && (
                  <div className="p-6 text-center text-fg-2">
                    <ShieldCheck className="w-12 h-12 mx-auto mb-2 text-status-success" />
                    <p>No security issues found.</p>
                  </div>
                )}
              </div>
            </PageSection>

            {/* Recommendations */}
            {report.findings.length > 0 && (
              <PageSection title="Recommendations" description="Suggested actions based on findings">
                <RecommendationsChecklist findings={report.findings} />
              </PageSection>
            )}
          </>
        )}

        {/* Initial State - No Report Yet */}
        {!report && !isRunning && (
          <div className="flex justify-center">
            <div className="w-full max-w-2xl p-8 text-center bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0">
              <Shield className="w-16 h-16 mx-auto mb-4 text-fg-3" />
              <h3 className="text-lg font-medium text-fg-0 mb-2">Run a Security Audit</h3>
              <p className="text-sm text-fg-2 max-w-md mx-auto mb-4">
                Scan your OpenClaw configuration for security issues including access control,
                tool permissions, network exposure, and file permissions.
              </p>
              <div className="flex flex-col gap-2 text-sm text-fg-2 max-w-sm mx-auto text-left">
                <div className="flex items-start gap-2">
                  <Play className="w-4 h-4 mt-0.5 text-accent-primary shrink-0" />
                  <span><strong>Run Audit</strong> - Basic security check</span>
                </div>
                <div className="flex items-start gap-2">
                  <Zap className="w-4 h-4 mt-0.5 text-fg-2 shrink-0" />
                  <span><strong>Deep Audit</strong> - Includes live Gateway probe</span>
                </div>
                <div className="flex items-start gap-2">
                  <Wrench className="w-4 h-4 mt-0.5 text-status-warning shrink-0" />
                  <span><strong>Apply Fixes</strong> - Auto-fix file permissions</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Loading State */}
        {isRunning && (
          <div className="p-8 bg-bg-2 rounded-[var(--radius-lg)]">
            <LoadingState
              height="auto"
              size="3xl"
              spinnerClassName="text-accent-primary"
              label={`Running ${auditType === 'deep' ? 'Deep ' : auditType === 'fix' ? 'Fix ' : ''}Audit...`}
              description={
                auditType === 'deep'
                  ? 'Performing comprehensive scan with Gateway probe...'
                  : auditType === 'fix'
                    ? 'Applying security fixes...'
                    : 'Scanning configuration for security issues...'
              }
            />
          </div>
        )}
      </div>

      {/* Confirm Modal for Fix Mode */}
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

// ============================================================================
// SUBCOMPONENTS
// ============================================================================

function SeverityCard({
  severity,
  count,
  icon: Icon,
}: {
  severity: 'critical' | 'warn' | 'info'
  count: number
  icon: React.ComponentType<{ className?: string }>
}) {
  const colors = {
    critical: 'bg-status-error/10 border-status-error/30 text-status-error',
    warn: 'bg-status-warning/10 border-status-warning/30 text-status-warning',
    info: 'bg-status-info/10 border-status-info/30 text-status-info',
  }

  const labels = {
    critical: 'Critical',
    warn: 'Warnings',
    info: 'Info',
  }

  return (
    <div className={cn('p-4 rounded-[var(--radius-lg)] border', colors[severity])}>
      <div className="flex items-center gap-3">
        <Icon className="w-6 h-6" />
        <div>
          <div className="text-2xl font-bold">{count}</div>
          <div className="text-sm opacity-80">{labels[severity]}</div>
        </div>
      </div>
    </div>
  )
}

function FindingsGroup({
  severity,
  findings,
}: {
  severity: 'critical' | 'warn' | 'info'
  findings: AuditFinding[]
}) {
  const [expanded, setExpanded] = useState(severity === 'critical')

  const colors = {
    critical: 'text-status-error',
    warn: 'text-status-warning',
    info: 'text-status-info',
  }

  const icons = {
    critical: XCircle,
    warn: AlertTriangle,
    info: Info,
  }

  const Icon = icons[severity]

  return (
    <div className="bg-bg-3 rounded-[var(--radius-md)] border border-bd-0 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 p-3 hover:bg-bg-2 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-fg-2" />
        ) : (
          <ChevronRight className="w-4 h-4 text-fg-2" />
        )}
        <Icon className={cn('w-4 h-4', colors[severity])} />
        <span className={cn('font-medium', colors[severity])}>
          {severity.charAt(0).toUpperCase() + severity.slice(1)}
        </span>
        <span className="text-sm text-fg-2">({findings.length})</span>
      </button>

      {expanded && (
        <div className="border-t border-bd-0">
          {findings.map((finding, idx) => (
            <FindingCard key={idx} finding={finding} />
          ))}
        </div>
      )}
    </div>
  )
}

function FindingCard({ finding }: { finding: AuditFinding }) {
  const [expanded, setExpanded] = useState(false)

  const colors = {
    critical: 'text-status-error',
    warn: 'text-status-warning',
    info: 'text-status-info',
  }

  const icons = {
    critical: XCircle,
    warn: AlertTriangle,
    info: Info,
  }

  const Icon = icons[finding.severity]

  return (
    <div className="border-b border-bd-0/50 last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start gap-2 p-3 text-left hover:bg-bg-2/50 transition-colors"
      >
        <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', colors[finding.severity])} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-fg-3 bg-bg-2 px-1.5 py-0.5 rounded">
              {finding.checkId}
            </span>
            <span className="text-sm text-fg-0">{finding.title}</span>
          </div>
        </div>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-fg-3 shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-fg-3 shrink-0" />
        )}
      </button>

      {expanded && finding.detail && (
        <div className="px-3 pb-3 pl-9">
          <pre className="text-xs text-fg-2 whitespace-pre-wrap font-mono bg-bg-2 p-2 rounded">
            {finding.detail}
          </pre>
        </div>
      )}
    </div>
  )
}

function GatewayProbeCard({
  deep,
}: {
  deep: NonNullable<AuditReport['deep']>
}) {
  const gateway = deep.gateway

  return (
    <div className={cn(
      'p-4 rounded-[var(--radius-md)] border flex items-center gap-4',
      gateway.ok
        ? 'bg-status-success/10 border-status-success/30'
        : 'bg-status-error/10 border-status-error/30'
    )}>
      {gateway.ok ? (
        <Wifi className="w-8 h-8 text-status-success" />
      ) : (
        <WifiOff className="w-8 h-8 text-status-error" />
      )}
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className={cn(
            'font-medium',
            gateway.ok ? 'text-status-success' : 'text-status-error'
          )}>
            {gateway.ok ? 'Gateway Reachable' : 'Gateway Unreachable'}
          </span>
          {gateway.attempted && (
            <span className="text-xs text-fg-3">(probe attempted)</span>
          )}
        </div>
        <div className="text-sm text-fg-2 font-mono">{gateway.url}</div>
        {gateway.error && (
          <div className="text-sm text-status-error mt-1">{gateway.error}</div>
        )}
        {gateway.close && (
          <div className="text-sm text-fg-2 mt-1">Close reason: {gateway.close}</div>
        )}
      </div>
    </div>
  )
}

function FixActionsPanel({ fixResult }: { fixResult: FixResult }) {
  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className={cn(
        'p-3 rounded-[var(--radius-md)] border flex items-center gap-3',
        fixResult.ok
          ? 'bg-status-success/10 border-status-success/30'
          : 'bg-status-error/10 border-status-error/30'
      )}>
        {fixResult.ok ? (
          <CheckCircle className="w-5 h-5 text-status-success" />
        ) : (
          <XCircle className="w-5 h-5 text-status-error" />
        )}
        <span className={fixResult.ok ? 'text-status-success' : 'text-status-error'}>
          {fixResult.ok ? 'Fixes applied successfully' : 'Some fixes failed'}
        </span>
      </div>

      {/* Config Changes */}
      {fixResult.changes.length > 0 && (
        <div className="bg-bg-3 rounded-[var(--radius-md)] border border-bd-0 p-3">
          <h4 className="text-sm font-medium text-fg-0 mb-2 flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Config Changes
          </h4>
          <ul className="text-sm text-fg-2 space-y-1">
            {fixResult.changes.map((change, idx) => (
              <li key={idx} className="flex items-center gap-2">
                <CheckCircle className="w-3 h-3 text-status-success shrink-0" />
                {change}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* File Permission Changes */}
      {fixResult.actions.length > 0 && (
        <div className="bg-bg-3 rounded-[var(--radius-md)] border border-bd-0 p-3">
          <h4 className="text-sm font-medium text-fg-0 mb-2 flex items-center gap-2">
            <FileKey className="w-4 h-4" />
            Permission Changes
          </h4>
          <div className="space-y-1">
            {fixResult.actions.map((action, idx) => (
              <FixActionRow key={idx} action={action} />
            ))}
          </div>
        </div>
      )}

      {/* Errors */}
      {fixResult.errors.length > 0 && (
        <div className="bg-status-error/10 border border-status-error/30 rounded-[var(--radius-md)] p-3">
          <h4 className="text-sm font-medium text-status-error mb-2">Errors</h4>
          <ul className="text-sm text-status-error space-y-1">
            {fixResult.errors.map((error, idx) => (
              <li key={idx}>{error}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function FixActionRow({ action }: { action: FixAction }) {
  const modeOctal = action.mode.toString(8).padStart(4, '0')

  return (
    <div className="flex items-center gap-2 text-sm">
      {action.ok ? (
        <CheckCircle className="w-3 h-3 text-status-success shrink-0" />
      ) : action.skipped ? (
        <span className="w-3 h-3 text-fg-3 shrink-0">-</span>
      ) : (
        <XCircle className="w-3 h-3 text-status-error shrink-0" />
      )}
      <span className="font-mono text-fg-2 truncate flex-1" title={action.path}>
        {action.path}
      </span>
      <span className="font-mono text-xs text-fg-3">{modeOctal}</span>
      {action.skipped && (
        <span className="text-xs text-fg-3">({action.skipped})</span>
      )}
    </div>
  )
}

function RecommendationsChecklist({ findings }: { findings: AuditFinding[] }) {
  // Extract actionable recommendations from findings
  const recommendations: { text: string; severity: string }[] = []

  findings.forEach((finding) => {
    if (finding.severity === 'critical') {
      recommendations.push({
        text: `Address critical issue: ${finding.title}`,
        severity: 'critical',
      })
    } else if (finding.severity === 'warn') {
      recommendations.push({
        text: `Review warning: ${finding.title}`,
        severity: 'warn',
      })
    }
  })

  // Add general recommendations
  if (findings.some((f) => f.severity === 'critical')) {
    recommendations.push({
      text: 'Run `openclaw security audit --fix` to apply automatic fixes',
      severity: 'info',
    })
  }

  if (findings.some((f) => f.checkId.includes('network') || f.checkId.includes('gateway'))) {
    recommendations.push({
      text: 'Review Gateway network exposure settings',
      severity: 'info',
    })
  }

  if (findings.some((f) => f.checkId.includes('tool') || f.checkId.includes('permission'))) {
    recommendations.push({
      text: 'Audit tool permissions and elevated access',
      severity: 'info',
    })
  }

  return (
    <div className="bg-bg-3 rounded-[var(--radius-md)] border border-bd-0 p-4">
      <div className="space-y-2">
        {recommendations.map((rec, idx) => (
          <label key={idx} className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              className="mt-0.5 w-4 h-4 rounded border-bd-1 bg-bg-2 text-accent-primary focus:ring-accent-primary"
            />
            <span className={cn(
              'text-sm',
              rec.severity === 'critical'
                ? 'text-status-error'
                : rec.severity === 'warn'
                  ? 'text-status-warning'
                  : 'text-fg-1'
            )}>
              {rec.text}
            </span>
          </label>
        ))}
      </div>

      <div className="mt-4 pt-3 border-t border-bd-0">
        <a
          href="https://docs.openclaw.ai/gateway/security"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-accent-primary hover:underline"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Security Documentation
        </a>
      </div>
    </div>
  )
}
