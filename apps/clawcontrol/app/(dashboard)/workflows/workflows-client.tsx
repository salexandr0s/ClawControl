'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader, EmptyState, TypedConfirmModal, Button, buttonLikeClass } from '@clawcontrol/ui'
import { CanonicalTable, type Column } from '@/components/ui/canonical-table'
import { RightDrawer } from '@/components/shell/right-drawer'
import { StatusPill } from '@/components/ui/status-pill'
import { LoadingState } from '@/components/ui/loading-state'
import { WorkflowEditorModal } from '@/components/workflows/workflow-editor-modal'
import { WorkflowVisualization } from '@/components/workflows/workflow-visualization'
import { ImportPackageModal } from '@/components/packages/import-package-modal'
import { TrustBadge } from '@/components/trust/trust-badge'
import { useProtectedAction } from '@/lib/hooks/useProtectedAction'
import { useSettings } from '@/lib/settings-context'
import { packagesApi, workflowsApi, type WorkflowDetail, type WorkflowListItem } from '@/lib/http'
import { cn } from '@/lib/utils'
import { Bot, ChevronDown, Copy, Download, FileUp, Plus, Tag, Trash2, Upload } from 'lucide-react'

function formatRelative(value: string): string {
  const ts = new Date(value).getTime()
  if (!Number.isFinite(ts)) return value
  const deltaSec = Math.floor((Date.now() - ts) / 1000)
  if (deltaSec < 60) return 'just now'
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h ago`
  return `${Math.floor(deltaSec / 86400)}d ago`
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

const workflowColumns: Column<WorkflowListItem>[] = [
  {
    key: 'id',
    header: 'Workflow',
    width: '220px',
    mono: true,
    render: (row) => (
      <div className="flex items-center gap-2">
        <span className={cn('w-2 h-2 rounded-full', row.source === 'built_in' ? 'bg-status-info' : 'bg-status-success')} />
        <span className="text-fg-0">{row.id}</span>
      </div>
    ),
  },
  {
    key: 'source',
    header: 'Source',
    width: '100px',
    render: (row) => (
      <StatusPill tone={row.source === 'built_in' ? 'info' : 'success'} label={row.source === 'built_in' ? 'Built-in' : 'Custom'} />
    ),
  },
  {
    key: 'trust',
    header: 'Trust',
    width: '140px',
    render: (row) => (
      <TrustBadge
        level={row.trustLevel}
        title={row.trustTitle}
        subtitle={row.trustSubtitle}
      />
    ),
  },
  {
    key: 'stages',
    header: 'Stages',
    width: '70px',
    align: 'center',
    mono: true,
    render: (row) => row.stages,
  },
  {
    key: 'loops',
    header: 'Loops',
    width: '70px',
    align: 'center',
    mono: true,
    render: (row) => row.loops,
  },
  {
    key: 'inUse',
    header: 'In Use',
    width: '70px',
    align: 'center',
    mono: true,
    render: (row) => row.inUse,
  },
  {
    key: 'updatedAt',
    header: 'Updated',
    width: '100px',
    align: 'right',
    render: (row) => <span className="text-xs text-fg-2">{formatRelative(row.updatedAt)}</span>,
  },
]

export function WorkflowsClient() {
  const { skipTypedConfirm } = useSettings()
  const protectedAction = useProtectedAction({ skipTypedConfirm })

  const [rows, setRows] = useState<WorkflowListItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<WorkflowDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [showEditor, setShowEditor] = useState(false)
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create')

  const [drawerTab, setDrawerTab] = useState<'overview' | 'stages' | 'yaml' | 'visualization' | 'usage'>('overview')
  const [workflowYaml, setWorkflowYaml] = useState('')

  const [showPackageImport, setShowPackageImport] = useState(false)

  const selectedRow = useMemo(() => rows.find((row) => row.id === selectedId) ?? null, [rows, selectedId])

  const refreshRows = useCallback(async () => {
    const result = await workflowsApi.list()
    setRows(result.data)
  }, [])

  const fetchRows = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      await refreshRows()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workflows')
    } finally {
      setLoading(false)
    }
  }, [refreshRows])

  const fetchDetail = useCallback(async (workflowId: string) => {
    setDetailLoading(true)
    try {
      const result = await workflowsApi.get(workflowId)
      setSelected(result.data)
      setDrawerTab('overview')

      const jsYaml = (await import('js-yaml')).default
      const dumped = jsYaml.dump(result.data.workflow, {
        indent: 2,
        lineWidth: 100,
        noRefs: true,
        sortKeys: false,
      })
      setWorkflowYaml(dumped)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workflow details')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchRows()
  }, [fetchRows])

  useEffect(() => {
    if (!selectedId) {
      setSelected(null)
      return
    }
    void fetchDetail(selectedId)
  }, [selectedId, fetchDetail])

  const handleCreate = () => {
    setEditorMode('create')
    setShowEditor(true)
  }

  const handleEdit = () => {
    if (!selected) return
    setEditorMode('edit')
    setShowEditor(true)
  }

  const handleSaveWorkflow = async (workflow: WorkflowDetail['workflow']) => {
    if (editorMode === 'create') {
      return new Promise<void>((resolve, reject) => {
        protectedAction.trigger({
          actionKind: 'workflow.create',
          actionTitle: 'Create Workflow',
          actionDescription: `Create custom workflow ${workflow.id}`,
          entityName: workflow.id,
          onConfirm: async (typedConfirmText) => {
            try {
              await workflowsApi.create({ workflow, typedConfirmText })
              await refreshRows()
              setSelectedId(workflow.id)
              setNotice(`Created workflow ${workflow.id}`)
              resolve()
            } catch (err) {
              reject(err)
              throw err
            }
          },
          onError: reject,
        })
      })
    }

    if (!selectedId) return

    return new Promise<void>((resolve, reject) => {
      protectedAction.trigger({
        actionKind: 'workflow.edit',
        actionTitle: 'Save Workflow',
        actionDescription: `Update workflow ${selectedId}`,
        entityName: selectedId,
        onConfirm: async (typedConfirmText) => {
          try {
            await workflowsApi.update(selectedId, { workflow, typedConfirmText })
            await Promise.all([refreshRows(), fetchDetail(selectedId)])
            setNotice(`Updated workflow ${selectedId}`)
            resolve()
          } catch (err) {
            reject(err)
            throw err
          }
        },
        onError: reject,
      })
    })
  }

  const handleClone = () => {
    if (!selected) return

    protectedAction.trigger({
      actionKind: 'workflow.clone',
      actionTitle: 'Clone Workflow',
      actionDescription: `Clone workflow ${selected.id} into a custom copy`,
      entityName: selected.id,
      onConfirm: async (typedConfirmText) => {
        await workflowsApi.clone(selected.id, { typedConfirmText })
        await refreshRows()
        setNotice(`Cloned workflow ${selected.id}`)
      },
      onError: (err) => setError(err.message),
    })
  }

  const handleDelete = () => {
    if (!selected) return

    protectedAction.trigger({
      actionKind: 'workflow.delete',
      actionTitle: 'Delete Workflow',
      actionDescription: `Delete custom workflow ${selected.id}`,
      entityName: selected.id,
      onConfirm: async (typedConfirmText) => {
        await workflowsApi.delete(selected.id, { typedConfirmText })
        setSelectedId(null)
        await refreshRows()
        setNotice(`Deleted workflow ${selected.id}`)
      },
      onError: (err) => setError(err.message),
    })
  }

  const handleExport = () => {
    if (!selected) return

    protectedAction.trigger({
      actionKind: 'workflow.export',
      actionTitle: 'Export Workflow',
      actionDescription: `Export workflow ${selected.id} as YAML`,
      entityName: selected.id,
      onConfirm: async (typedConfirmText) => {
        const blob = await workflowsApi.export(selected.id, typedConfirmText)
        downloadBlob(blob, `${selected.id}.workflow.yaml`)
        setNotice(`Exported workflow ${selected.id}`)
      },
      onError: (err) => setError(err.message),
    })
  }

  const handleExportPackage = () => {
    if (!selected) return

    protectedAction.trigger({
      actionKind: 'package.export',
      actionTitle: 'Export Workflow Package',
      actionDescription: `Export workflow ${selected.id} as .clawpack.zip`,
      entityName: selected.id,
      onConfirm: async (typedConfirmText) => {
        const blob = await packagesApi.export(selected.id, 'workflow', typedConfirmText)
        downloadBlob(blob, `${selected.id}.clawpack.zip`)
        setNotice(`Exported workflow package ${selected.id}`)
      },
      onError: (err) => setError(err.message),
    })
  }

  const handleImportWorkflowFile = (file: File) => {
    protectedAction.trigger({
      actionKind: 'workflow.import',
      actionTitle: 'Import Workflow',
      actionDescription: `Import workflow definitions from ${file.name}`,
      entityName: file.name,
      onConfirm: async (typedConfirmText) => {
        await workflowsApi.importFile({ file, typedConfirmText })
        await refreshRows()
        setNotice(`Imported workflows from ${file.name}`)
      },
      onError: (err) => setError(err.message),
    })
  }

  if (loading) {
    return <LoadingState height="viewport" />
  }

  if (error && rows.length === 0) {
    return (
      <EmptyState
        title="Failed to load workflows"
        description={error}
      />
    )
  }

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title="Workflows"
          subtitle={`${rows.length} workflows available`}
          actions={
            <div className="flex items-center gap-2">
              <Button
                type="button"
                onClick={() => setShowPackageImport(true)}
                variant="secondary"
                size="sm"
              >
                <Upload className="w-3.5 h-3.5" />
                Import Package
              </Button>

              <label className={buttonLikeClass({ variant: 'secondary', size: 'sm', className: 'cursor-pointer' })}>
                <FileUp className="w-3.5 h-3.5" />
                Import Workflow
                <input
                  type="file"
                  accept=".yaml,.yml,.zip"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) {
                      handleImportWorkflowFile(file)
                    }
                    event.currentTarget.value = ''
                  }}
                />
              </label>

              <Button type="button" onClick={handleCreate} variant="primary" size="sm">
                <Plus className="w-3.5 h-3.5" />
                New Workflow
              </Button>
            </div>
          }
        />

        {notice && (
          <div className="rounded-[var(--radius-sm)] border border-status-success/40 bg-status-success/10 text-status-success text-sm p-2">
            {notice}
          </div>
        )}

        {error && (
          <div className="rounded-[var(--radius-sm)] border border-status-danger/40 bg-status-danger/10 text-status-danger text-sm p-2">
            {error}
          </div>
        )}

        <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0 overflow-hidden">
          <CanonicalTable
            columns={workflowColumns}
            rows={rows}
            rowKey={(row) => row.id}
            onRowClick={(row) => setSelectedId(row.id)}
            selectedKey={selectedId ?? undefined}
            density="compact"
            emptyState={
              <EmptyState
                title="No workflows"
                description="Create your first custom workflow to start orchestration."
              />
            }
          />
        </div>
      </div>

      <RightDrawer
        open={Boolean(selectedId)}
        onClose={() => setSelectedId(null)}
        title={selected?.id || selectedRow?.id || 'Workflow'}
        description={selected?.workflow.description || selectedRow?.description || ''}
      >
        {detailLoading || !selected ? (
          <LoadingState height="sm" />
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-1 border-b border-bd-0 -mx-4 px-4 pb-2 overflow-x-auto">
              {(['overview', 'stages', 'yaml', 'visualization', 'usage'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setDrawerTab(tab)}
                  className={cn(
                    'px-2.5 py-1.5 text-xs font-medium rounded-[var(--radius-sm)] whitespace-nowrap',
                    drawerTab === tab ? 'bg-bg-3 text-fg-0' : 'text-fg-2 hover:text-fg-1'
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>

            {drawerTab === 'overview' && (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded bg-bg-2 p-2"><span className="text-fg-2">Source:</span> <span className="text-fg-1">{selected.source}</span></div>
                  <div className="rounded bg-bg-2 p-2"><span className="text-fg-2">Stages:</span> <span className="text-fg-1">{selected.stages}</span></div>
                  <div className="rounded bg-bg-2 p-2"><span className="text-fg-2">Loops:</span> <span className="text-fg-1">{selected.loops}</span></div>
                  <div className="rounded bg-bg-2 p-2"><span className="text-fg-2">In Use:</span> <span className="text-fg-1">{selected.usage.totalWorkOrders}</span></div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <Button type="button" onClick={handleClone} variant="secondary" size="sm">
                    <Copy className="w-3.5 h-3.5" />
                    Clone
                  </Button>
                  <Button type="button" onClick={handleExport} variant="secondary" size="sm">
                    <Download className="w-3.5 h-3.5" />
                    Export
                  </Button>
                  <Button type="button" onClick={handleExportPackage} variant="secondary" size="sm">
                    <Download className="w-3.5 h-3.5" />
                    Export Package
                  </Button>
                  {selected.source === 'custom' && (
                    <>
                      <Button type="button" onClick={handleEdit} variant="secondary" size="sm">Edit</Button>
                      <Button type="button" onClick={handleDelete} variant="danger" size="sm">
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )}

            {drawerTab === 'stages' && (
              <div className="space-y-2">
                {selected.workflow.stages.map((stage, index) => (
                  <div key={stage.ref}>
                    <div className="rounded-[var(--radius-sm)] border border-bd-0 bg-bg-2 p-2.5 space-y-1.5">
                      <div className="text-sm text-fg-0">{index + 1}. {stage.ref}</div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 rounded-pill border border-bd-0 bg-bg-3 px-2 py-0.5 text-[11px] text-fg-1">
                          <Bot className="w-3 h-3 text-fg-2" />
                          {stage.agent}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-pill border border-bd-0 bg-bg-3 px-2 py-0.5 text-[11px] text-fg-1">
                          <Tag className="w-3 h-3 text-fg-2" />
                          {stage.type ?? 'single'}
                        </span>
                      </div>
                    </div>
                    {index < selected.workflow.stages.length - 1 && (
                      <div className="flex justify-center py-1">
                        <ChevronDown className="w-3.5 h-3.5 text-fg-3" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {drawerTab === 'yaml' && (
              <pre className="text-xs font-mono whitespace-pre-wrap rounded-[var(--radius-sm)] border border-bd-0 bg-bg-2 p-3 overflow-auto max-h-[420px]">
                {workflowYaml}
              </pre>
            )}

            {drawerTab === 'visualization' && (
              <WorkflowVisualization workflow={selected.workflow} />
            )}

            {drawerTab === 'usage' && (
              <div className="space-y-2 text-sm">
                <div className="rounded bg-bg-2 p-2">
                  <div className="text-fg-2 text-xs">Total work orders</div>
                  <div className="text-fg-0">{selected.usage.totalWorkOrders}</div>
                </div>
                <div className="rounded bg-bg-2 p-2">
                  <div className="text-fg-2 text-xs">Active work orders</div>
                  <div className="text-fg-0">{selected.usage.activeWorkOrders}</div>
                </div>
              </div>
            )}
          </div>
        )}
      </RightDrawer>

      <WorkflowEditorModal
        open={showEditor}
        mode={editorMode}
        initialWorkflow={editorMode === 'edit' ? selected?.workflow : null}
        onClose={() => setShowEditor(false)}
        onSave={handleSaveWorkflow}
      />

      <ImportPackageModal
        open={showPackageImport}
        onClose={() => setShowPackageImport(false)}
        onDeployed={async () => {
          await refreshRows()
        }}
      />

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
