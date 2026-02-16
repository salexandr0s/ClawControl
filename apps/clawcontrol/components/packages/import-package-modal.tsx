'use client'

import { useEffect, useMemo, useState } from 'react'
import { TypedConfirmModal, Button } from '@clawcontrol/ui'
import { Modal } from '@/components/ui/modal'
import { useProtectedAction } from '@/lib/hooks/useProtectedAction'
import { useSettings } from '@/lib/settings-context'
import { packagesApi, type PackageImportAnalysis } from '@/lib/http'
import { cn } from '@/lib/utils'
import { CheckCircle, FileArchive, Upload, AlertTriangle, Rocket, RotateCcw, Download } from 'lucide-react'
import { TrustBadge } from '@/components/trust/trust-badge'

interface ImportPackageModalProps {
  open: boolean
  onClose: () => void
  onDeployed?: () => Promise<void> | void
}

export function ImportPackageModal({
  open,
  onClose,
  onDeployed,
}: ImportPackageModalProps) {
  const { skipTypedConfirm } = useSettings()
  const protectedAction = useProtectedAction({ skipTypedConfirm })

  const [file, setFile] = useState<File | null>(null)
  const [analysis, setAnalysis] = useState<PackageImportAnalysis | null>(null)
  const [isWorking, setIsWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [applyTemplates, setApplyTemplates] = useState(true)
  const [applyWorkflows, setApplyWorkflows] = useState(true)
  const [applyTeams, setApplyTeams] = useState(true)
  const [applySelection, setApplySelection] = useState(true)
  const [overwriteTemplates, setOverwriteTemplates] = useState(false)
  const [overwriteWorkflows, setOverwriteWorkflows] = useState(false)
  const [overwriteTeams, setOverwriteTeams] = useState(false)
  const [overrideScanBlock, setOverrideScanBlock] = useState(false)

  useEffect(() => {
    if (!open) return
    setFile(null)
    setAnalysis(null)
    setError(null)
    setIsWorking(false)
    setApplyTemplates(true)
    setApplyWorkflows(true)
    setApplyTeams(true)
    setApplySelection(true)
    setOverwriteTemplates(false)
    setOverwriteWorkflows(false)
    setOverwriteTeams(false)
    setOverrideScanBlock(false)
  }, [open])

  const hasConflicts = useMemo(() => {
    if (!analysis) return false
    return (
      analysis.conflicts.templates.length > 0
      || analysis.conflicts.workflows.length > 0
      || analysis.conflicts.teams.length > 0
    )
  }, [analysis])

  const hasTemplateConflicts = (analysis?.conflicts.templates.length ?? 0) > 0
  const hasWorkflowConflicts = (analysis?.conflicts.workflows.length ?? 0) > 0
  const hasTeamConflicts = (analysis?.conflicts.teams.length ?? 0) > 0

  useEffect(() => {
    if (!hasTemplateConflicts) setOverwriteTemplates(false)
    if (!hasWorkflowConflicts) setOverwriteWorkflows(false)
    if (!hasTeamConflicts) setOverwriteTeams(false)
  }, [hasTemplateConflicts, hasWorkflowConflicts, hasTeamConflicts])

  const deployOptions = useMemo(() => ({
    applyTemplates,
    applyWorkflows,
    applyTeams,
    applySelection,
    overwriteTemplates: overwriteTemplates && applyTemplates && hasTemplateConflicts,
    overwriteWorkflows: overwriteWorkflows && applyWorkflows && hasWorkflowConflicts,
    overwriteTeams: overwriteTeams && applyTeams && hasTeamConflicts,
  }), [
    applyTemplates,
    applyWorkflows,
    applyTeams,
    applySelection,
    overwriteTemplates,
    overwriteWorkflows,
    overwriteTeams,
    hasTemplateConflicts,
    hasWorkflowConflicts,
    hasTeamConflicts,
  ])

  const handleAnalyze = () => {
    if (!file) return

    protectedAction.trigger({
      actionKind: 'package.import',
      actionTitle: 'Analyze Package',
      actionDescription: `Analyze package ${file.name} before deployment`,
      entityName: file.name,
      onConfirm: async (typedConfirmText) => {
        setIsWorking(true)
        setError(null)
        try {
          const result = await packagesApi.import({
            file,
            typedConfirmText,
          })
          setAnalysis(result.data)
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to analyze package')
          throw err
        } finally {
          setIsWorking(false)
        }
      },
      onError: (err) => {
        setError(err.message)
      },
    })
  }

  const handleDeploy = () => {
    if (!analysis) return

    protectedAction.trigger({
      actionKind: analysis.blockedByScan && overrideScanBlock
        ? 'package.deploy.override_scan_block'
        : 'package.deploy',
      actionTitle: 'Deploy Package',
      actionDescription: `Deploy package ${analysis.manifest.name} (${analysis.manifest.kind})`,
      entityName: analysis.manifest.name,
      onConfirm: async (typedConfirmText) => {
        setIsWorking(true)
        setError(null)
        try {
          await packagesApi.deploy({
            packageId: analysis.packageId,
            options: deployOptions,
            typedConfirmText,
            overrideScanBlock: analysis.blockedByScan ? overrideScanBlock : undefined,
          })

          await onDeployed?.()
          onClose()
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to deploy package')
          throw err
        } finally {
          setIsWorking(false)
        }
      },
      onError: (err) => {
        setError(err.message)
      },
    })
  }

  const handleDownloadInstallDoc = () => {
    if (!analysis?.installDoc?.preview) return

    const rawName = analysis.installDoc.path?.trim() || 'POST_INSTALL.md'
    const fileName = rawName.toLowerCase().endsWith('.md') ? rawName : `${rawName}.md`

    const blob = new Blob([analysis.installDoc.preview], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        width="lg"
        title="Import Package"
        description="Analyze and deploy .clawpack.zip artifacts"
      >
        <div className="space-y-4">
          <div className="rounded-[var(--radius-md)] border border-bd-0 bg-bg-2 p-4 space-y-3">
            <div className="text-sm font-medium text-fg-0">Step 1: Analyze</div>

            <label className="flex items-center gap-2 text-xs text-fg-2">
              <FileArchive className="w-3.5 h-3.5" />
              Package file (.zip)
            </label>
            <input
              type="file"
              accept=".zip"
              onChange={(event) => {
                const next = event.target.files?.[0] ?? null
                setFile(next)
                setAnalysis(null)
                setError(null)
              }}
              className="w-full text-sm text-fg-1"
            />

            <Button
              type="button"
              onClick={handleAnalyze}
              disabled={!file || isWorking}
              variant="secondary"
              size="sm"
            >
              <Upload className="w-3.5 h-3.5" />
              Analyze
            </Button>
          </div>

          {analysis && (
            <div className="rounded-[var(--radius-md)] border border-bd-0 bg-bg-2 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium text-fg-0">Step 2: Deploy</div>
                <span className="text-xs text-fg-2">Staged until {new Date(analysis.stagedUntil).toLocaleTimeString()}</span>
              </div>

              <div className="text-sm text-fg-1">
                <span className="font-medium text-fg-0">{analysis.manifest.name}</span>
                {' '}({analysis.manifest.kind})
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs text-fg-2">
                <div>Templates: {analysis.summary.templates}</div>
                <div>Workflows: {analysis.summary.workflows}</div>
                <div>Teams: {analysis.summary.teams}</div>
                <div>Selection: {analysis.summary.hasSelection ? 'yes' : 'no'}</div>
              </div>

              {analysis.installDoc?.preview && (
                <div className="rounded-[var(--radius-sm)] border border-status-warning/40 bg-status-warning/10 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-status-warning">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>IMPORTANT: Post-Install Instructions</span>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={handleDownloadInstallDoc}
                      disabled={isWorking}
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download .md
                    </Button>
                  </div>
                  {analysis.installDoc.path && (
                    <div className="text-[11px] text-fg-2">
                      Source file: {analysis.installDoc.path}
                    </div>
                  )}
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-[var(--radius-sm)] bg-bg-2 p-2 text-[11px] text-fg-1">
                    {analysis.installDoc.preview}
                  </pre>
                  <div className="text-[11px] text-fg-1">
                    After deploy: go to Agents → Teams and click Deploy.
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 text-xs">
                <label className="flex items-center gap-2 text-fg-1">
                  <input type="checkbox" checked={applyTemplates} onChange={(e) => setApplyTemplates(e.target.checked)} />
                  Apply templates
                </label>
                <label className="flex items-center gap-2 text-fg-1">
                  <input type="checkbox" checked={applyWorkflows} onChange={(e) => setApplyWorkflows(e.target.checked)} />
                  Apply workflows
                </label>
                <label className="flex items-center gap-2 text-fg-1">
                  <input type="checkbox" checked={applyTeams} onChange={(e) => setApplyTeams(e.target.checked)} />
                  Apply teams
                </label>
                <label className="flex items-center gap-2 text-fg-1">
                  <input type="checkbox" checked={applySelection} onChange={(e) => setApplySelection(e.target.checked)} />
                  Apply selection
                </label>
              </div>

              {hasConflicts && (
                <div className="rounded-[var(--radius-sm)] border border-status-warning/40 bg-status-warning/10 p-2 text-xs text-status-warning space-y-1">
                  <div className="flex items-center gap-1.5 font-medium">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Conflicts detected
                  </div>
                  {analysis.conflicts.templates.length > 0 && (
                    <div>Templates: {analysis.conflicts.templates.join(', ')}</div>
                  )}
                  {analysis.conflicts.workflows.length > 0 && (
                    <div>Workflows: {analysis.conflicts.workflows.join(', ')}</div>
                  )}
                  {analysis.conflicts.teams.length > 0 && (
                    <div>Teams: {analysis.conflicts.teams.join(', ')}</div>
                  )}

                  <div className="pt-2 space-y-1 text-fg-1">
                    <div className="text-[11px] text-fg-2">Update options (overwrite existing)</div>
                    {hasTemplateConflicts && (
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={overwriteTemplates}
                          onChange={(e) => setOverwriteTemplates(e.target.checked)}
                          disabled={!applyTemplates}
                        />
                        Overwrite templates
                      </label>
                    )}
                    {hasWorkflowConflicts && (
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={overwriteWorkflows}
                          onChange={(e) => setOverwriteWorkflows(e.target.checked)}
                          disabled={!applyWorkflows}
                        />
                        Overwrite workflows
                      </label>
                    )}
                    {hasTeamConflicts && (
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={overwriteTeams}
                          onChange={(e) => setOverwriteTeams(e.target.checked)}
                          disabled={!applyTeams}
                        />
                        Update teams by slug
                      </label>
                    )}
                  </div>
                </div>
              )}

              {analysis.blockedByScan && (
                <div className="rounded-[var(--radius-sm)] border border-status-danger/40 bg-status-danger/10 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-medium text-status-danger">Blocked by security scan</div>
                    <div className="text-[11px] text-fg-2 font-mono">
                      sha256 {analysis.sha256.slice(0, 12)}…
                    </div>
                  </div>

                  <div className="text-[11px] text-fg-1">
                    Danger {analysis.scan.summaryCounts.danger} • Warning {analysis.scan.summaryCounts.warning} • Info {analysis.scan.summaryCounts.info}
                  </div>

                  {analysis.scan.findings.length > 0 && (
                    <div className="text-[11px] text-fg-1">
                      <div className="text-fg-2 mb-1">Top findings</div>
                      <ul className="list-disc pl-4 space-y-0.5">
                        {analysis.scan.findings.slice(0, 4).map((f, idx) => (
                          <li key={`${f.code}-${idx}`}>
                            <span className="font-mono text-fg-2">[{f.severity}]</span>{' '}
                            {f.title}
                            {f.path ? <span className="text-fg-2"> ({f.path})</span> : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {analysis.alertWorkOrderId ? (
                    <div className="text-[11px] text-fg-1">
                      Incident created:{' '}
                      <a
                        className="text-status-info hover:underline underline-offset-2 font-mono"
                        href={`/work-orders/${analysis.alertWorkOrderId}`}
                      >
                        {analysis.alertWorkOrderId}
                      </a>
                    </div>
                  ) : null}

                  <label className="flex items-center gap-2 text-[11px] text-fg-1 pt-1">
                    <input
                      type="checkbox"
                      checked={overrideScanBlock}
                      onChange={(e) => setOverrideScanBlock(e.target.checked)}
                      disabled={isWorking}
                    />
                    Override scan block (requires additional approvals)
                  </label>
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  onClick={handleDeploy}
                  disabled={isWorking || (analysis.blockedByScan && !overrideScanBlock)}
                  variant="primary"
                  size="sm"
                >
                  <Rocket className="w-3.5 h-3.5" />
                  {analysis.blockedByScan && overrideScanBlock ? 'Override & Deploy' : 'Deploy'}
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    setAnalysis(null)
                    setError(null)
                  }}
                  disabled={isWorking}
                  variant="secondary"
                  size="sm"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset
                </Button>
              </div>
            </div>
          )}

          {error && (
            <div className={cn(
              'rounded-[var(--radius-sm)] border p-2 text-sm',
              'bg-status-danger/10 border-status-danger/40 text-status-danger'
            )}>
              {error}
            </div>
          )}

          {!error && analysis && (
            <div className="rounded-[var(--radius-sm)] border border-bd-0 bg-bg-2 p-2 text-sm text-fg-1 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <CheckCircle className="w-4 h-4 text-status-success shrink-0" />
                <span className="truncate">Package analyzed. Review options then deploy.</span>
              </div>
              <TrustBadge
                level={
                  analysis.blockedByScan
                    ? 'blocked'
                    : (analysis.scan.outcome === 'pass' || analysis.scan.outcome === 'warn')
                      ? 'scanned'
                      : 'unscanned'
                }
                title={
                  analysis.blockedByScan
                    ? 'Blocked by scan'
                    : analysis.scan.outcome === 'warn'
                      ? 'Scanned (warnings)'
                      : 'Scanned'
                }
                subtitle={`sha256 ${analysis.sha256.slice(0, 12)}… • ${analysis.scan.scannerVersion}`}
              />
            </div>
          )}
        </div>
      </Modal>

      <TypedConfirmModal
        isOpen={protectedAction.state.isOpen}
        onClose={protectedAction.cancel}
        onConfirm={protectedAction.confirm}
        actionTitle={protectedAction.state.actionTitle}
        actionDescription={protectedAction.state.actionDescription}
        confirmMode={protectedAction.confirmMode}
        confirmText={protectedAction.confirmMode === 'CONFIRM' ? protectedAction.confirmText : undefined}
        riskLevel={protectedAction.riskLevel}
        entityName={protectedAction.state.entityName}
        isLoading={protectedAction.state.isLoading}
      />
    </>
  )
}
