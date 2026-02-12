'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { EmptyState, TypedConfirmModal, Button, SelectDropdown } from '@clawcontrol/ui'
import { CanonicalTable, type Column } from '@/components/ui/canonical-table'
import { RightDrawer } from '@/components/shell/right-drawer'
import { Modal } from '@/components/ui/modal'
import { ImportPackageModal } from '@/components/packages/import-package-modal'
import {
  agentTeamsApi,
  packagesApi,
  templatesApi,
  workflowsApi,
  type AgentTeamSummary,
  type TemplateSummary,
  type WorkflowListItem,
} from '@/lib/http'
import { useProtectedAction } from '@/lib/hooks/useProtectedAction'
import { useSettings } from '@/lib/settings-context'
import { Download, Info, Plus, Trash2, Upload, X } from 'lucide-react'

const teamColumns: Column<AgentTeamSummary>[] = [
  {
    key: 'name',
    header: 'Team',
    width: '220px',
    render: (row) => (
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-status-success" />
        <span className="text-fg-0">{row.name}</span>
      </div>
    ),
  },
  {
    key: 'source',
    header: 'Source',
    width: '90px',
    mono: true,
    render: (row) => row.source,
  },
  {
    key: 'memberCount',
    header: 'Members',
    width: '70px',
    align: 'center',
    mono: true,
    render: (row) => row.memberCount,
  },
  {
    key: 'workflowIds',
    header: 'Workflows',
    width: '80px',
    align: 'center',
    mono: true,
    render: (row) => row.workflowIds.length,
  },
  {
    key: 'updatedAt',
    header: 'Updated',
    width: '100px',
    align: 'right',
    render: (row) => <span className="text-xs text-fg-2">{new Date(row.updatedAt).toLocaleDateString()}</span>,
  },
]

interface TeamEditorDraft {
  id?: string
  name: string
  description: string
  workflowIds: string[]
  templateIds: string[]
}

function toDraft(team: AgentTeamSummary | null): TeamEditorDraft {
  if (!team) {
    return {
      name: '',
      description: '',
      workflowIds: [],
      templateIds: [],
    }
  }

  return {
    id: team.id,
    name: team.name,
    description: team.description ?? '',
    workflowIds: [...team.workflowIds],
    templateIds: [...team.templateIds],
  }
}

interface TeamEditorModalProps {
  open: boolean
  mode: 'create' | 'edit'
  draft: TeamEditorDraft
  workflows: WorkflowListItem[]
  templates: TemplateSummary[]
  optionsLoading: boolean
  optionsError: string | null
  onClose: () => void
  onChange: (next: TeamEditorDraft) => void
  onSubmit: () => Promise<void>
  isSubmitting: boolean
}

function FieldInfoTooltip({ copy }: { copy: string }) {
  return (
    <span className="relative inline-flex group">
      <button
        type="button"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-bd-0 bg-bg-2 text-fg-3 hover:text-fg-1"
        aria-label="Field help"
      >
        <Info className="h-3 w-3" />
      </button>
      <span className="pointer-events-none absolute left-0 top-[calc(100%+6px)] z-20 hidden w-64 rounded-[var(--radius-sm)] border border-bd-0 bg-bg-2 p-2 text-[11px] text-fg-1 shadow-lg group-hover:block group-focus-within:block">
        {copy}
      </span>
    </span>
  )
}

function SelectionChip({
  id,
  sublabel,
  onRemove,
}: {
  id: string
  sublabel?: string
  onRemove: () => void
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-bd-0 bg-bg-3 px-2 py-1">
      <span className="min-w-0">
        <span className="block font-mono text-xs text-fg-0 truncate max-w-[220px]">{id}</span>
        {sublabel && <span className="block text-[10px] text-fg-3 truncate max-w-[220px]">{sublabel}</span>}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="rounded-[var(--radius-xs)] p-0.5 text-fg-3 hover:text-fg-1 hover:bg-bg-2"
        aria-label={`Remove ${id}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}

function TeamEditorModal({
  open,
  mode,
  draft,
  workflows,
  templates,
  optionsLoading,
  optionsError,
  onClose,
  onChange,
  onSubmit,
  isSubmitting,
}: TeamEditorModalProps) {
  const canSubmit = draft.name.trim().length > 0 && !isSubmitting
  const workflowById = new Map(workflows.map((workflow) => [workflow.id, workflow] as const))
  const templateById = new Map(templates.map((template) => [template.id, template] as const))
  const workflowOptions = workflows
    .filter((workflow) => !draft.workflowIds.includes(workflow.id))
    .map((workflow) => ({
      value: workflow.id,
      label: workflow.id,
      description: workflow.description || 'No description',
      textValue: `${workflow.id} ${workflow.description}`,
    }))
  const templateOptions = templates
    .filter((template) => !draft.templateIds.includes(template.id))
    .map((template) => ({
      value: template.id,
      label: template.id,
      description: template.name,
      textValue: `${template.id} ${template.name} ${template.description}`,
    }))

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="lg"
      title={mode === 'create' ? 'New Team' : 'Edit Team'}
      description="Team metadata and linked workflows/templates"
    >
      <div className="space-y-3">
        <label className="space-y-1 text-sm block">
          <span className="text-fg-2">Name</span>
          <input
            value={draft.name}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
            className="w-full px-3 py-2 bg-bg-2 border border-bd-0 rounded-[var(--radius-sm)] text-sm text-fg-0"
          />
        </label>

        <label className="space-y-1 text-sm block">
          <span className="text-fg-2">Description</span>
          <textarea
            value={draft.description}
            onChange={(event) => onChange({ ...draft, description: event.target.value })}
            rows={3}
            className="w-full px-3 py-2 bg-bg-2 border border-bd-0 rounded-[var(--radius-sm)] text-sm text-fg-0"
          />
        </label>

        <div className="space-y-1 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="text-fg-2">Workflows</span>
            <FieldInfoTooltip copy="Workflow IDs identify orchestration pipelines this team is linked to." />
          </div>
          <SelectDropdown
            value={null}
            onChange={(workflowId) => onChange({ ...draft, workflowIds: [...draft.workflowIds, workflowId] })}
            ariaLabel="Add workflow"
            tone="field"
            size="md"
            placeholder={optionsLoading ? 'Loading workflows…' : 'Select workflow...'}
            options={workflowOptions}
            disabled={optionsLoading || workflowOptions.length === 0}
            search="auto"
            emptyMessage="No more workflows available"
          />
          <div className="flex flex-wrap gap-2 pt-1">
            {draft.workflowIds.length === 0 && (
              <span className="text-xs text-fg-3">No workflows linked.</span>
            )}
            {draft.workflowIds.map((workflowId) => {
              const workflow = workflowById.get(workflowId)
              return (
                <SelectionChip
                  key={workflowId}
                  id={workflowId}
                  sublabel={workflow?.description}
                  onRemove={() => onChange({ ...draft, workflowIds: draft.workflowIds.filter((id) => id !== workflowId) })}
                />
              )
            })}
          </div>
        </div>

        <div className="space-y-1 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="text-fg-2">Templates</span>
            <FieldInfoTooltip copy="Template IDs reference agent blueprints this team typically uses." />
          </div>
          <SelectDropdown
            value={null}
            onChange={(templateId) => onChange({ ...draft, templateIds: [...draft.templateIds, templateId] })}
            ariaLabel="Add template"
            tone="field"
            size="md"
            placeholder={optionsLoading ? 'Loading templates…' : 'Select template...'}
            options={templateOptions}
            disabled={optionsLoading || templateOptions.length === 0}
            search="auto"
            emptyMessage="No more templates available"
          />
          <div className="flex flex-wrap gap-2 pt-1">
            {draft.templateIds.length === 0 && (
              <span className="text-xs text-fg-3">No templates linked.</span>
            )}
            {draft.templateIds.map((templateId) => {
              const template = templateById.get(templateId)
              return (
                <SelectionChip
                  key={templateId}
                  id={templateId}
                  sublabel={template?.name}
                  onRemove={() => onChange({ ...draft, templateIds: draft.templateIds.filter((id) => id !== templateId) })}
                />
              )
            })}
          </div>
        </div>

        {optionsError && (
          <div className="rounded-[var(--radius-sm)] border border-status-warning/40 bg-status-warning/10 p-2 text-xs text-status-warning">
            {optionsError}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose} variant="secondary" size="sm" type="button">Cancel</Button>
          <Button
            onClick={() => { void onSubmit() }}
            disabled={!canSubmit}
            variant="primary"
            size="sm"
            type="button"
          >
            {isSubmitting ? 'Saving...' : mode === 'create' ? 'Create Team' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export function TeamsTab() {
  const { skipTypedConfirm } = useSettings()
  const protectedAction = useProtectedAction({ skipTypedConfirm })

  const [teams, setTeams] = useState<AgentTeamSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = useMemo(() => teams.find((item) => item.id === selectedId) ?? null, [teams, selectedId])

  const [showEditor, setShowEditor] = useState(false)
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create')
  const [draft, setDraft] = useState<TeamEditorDraft>(toDraft(null))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [workflowOptions, setWorkflowOptions] = useState<WorkflowListItem[]>([])
  const [templateOptions, setTemplateOptions] = useState<TemplateSummary[]>([])
  const [editorOptionsLoading, setEditorOptionsLoading] = useState(false)
  const [editorOptionsError, setEditorOptionsError] = useState<string | null>(null)

  const [showPackageImport, setShowPackageImport] = useState(false)

  const fetchTeams = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const result = await agentTeamsApi.list()
      setTeams(result.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load teams')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchTeams()
  }, [fetchTeams])

  const loadEditorOptions = useCallback(async () => {
    setEditorOptionsLoading(true)
    setEditorOptionsError(null)
    try {
      const [workflowsResult, templatesResult] = await Promise.all([
        workflowsApi.list(),
        templatesApi.list(),
      ])
      setWorkflowOptions(workflowsResult.data)
      setTemplateOptions(templatesResult.data.filter((template) => template.isValid))
    } catch (err) {
      setEditorOptionsError(err instanceof Error ? err.message : 'Failed to load workflows/templates')
    } finally {
      setEditorOptionsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!showEditor) return
    void loadEditorOptions()
  }, [showEditor, loadEditorOptions])

  const openCreate = () => {
    setEditorMode('create')
    setDraft(toDraft(null))
    setShowEditor(true)
  }

  const openEdit = () => {
    if (!selected) return
    setEditorMode('edit')
    setDraft(toDraft(selected))
    setShowEditor(true)
  }

  const saveTeam = async () => {
    setIsSubmitting(true)
    setError(null)

    const payload = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      workflowIds: [...draft.workflowIds],
      templateIds: [...draft.templateIds],
    }

    try {
      if (editorMode === 'create') {
        await new Promise<void>((resolve, reject) => {
          protectedAction.trigger({
            actionKind: 'team.create',
            actionTitle: 'Create Team',
            actionDescription: `Create team ${payload.name}`,
            entityName: payload.name,
            onConfirm: async (typedConfirmText) => {
              try {
                await agentTeamsApi.create({ ...payload, typedConfirmText })
                resolve()
              } catch (err) {
                reject(err)
                throw err
              }
            },
            onError: reject,
          })
        })
      } else if (selected) {
        await new Promise<void>((resolve, reject) => {
          protectedAction.trigger({
            actionKind: 'team.edit',
            actionTitle: 'Edit Team',
            actionDescription: `Update team ${selected.name}`,
            entityName: selected.name,
            onConfirm: async (typedConfirmText) => {
              try {
                await agentTeamsApi.update(selected.id, { ...payload, typedConfirmText })
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

      setShowEditor(false)
      await fetchTeams()
      setNotice(editorMode === 'create' ? 'Team created' : 'Team updated')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save team')
    } finally {
      setIsSubmitting(false)
    }
  }

  const deleteTeam = () => {
    if (!selected) return

    protectedAction.trigger({
      actionKind: 'team.delete',
      actionTitle: 'Delete Team',
      actionDescription: `Delete team ${selected.name}`,
      entityName: selected.name,
      onConfirm: async (typedConfirmText) => {
        await agentTeamsApi.delete(selected.id, { typedConfirmText })
        setSelectedId(null)
        await fetchTeams()
        setNotice('Team deleted')
      },
      onError: (err) => setError(err.message),
    })
  }

  const exportTeam = () => {
    if (!selected) return

    protectedAction.trigger({
      actionKind: 'team.export',
      actionTitle: 'Export Team',
      actionDescription: `Export team ${selected.name} as YAML`,
      entityName: selected.name,
      onConfirm: async (typedConfirmText) => {
        const blob = await agentTeamsApi.export(selected.id, typedConfirmText)
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `${selected.slug || selected.id}.team.yaml`
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        URL.revokeObjectURL(url)
        setNotice('Team exported')
      },
      onError: (err) => setError(err.message),
    })
  }

  const exportTeamPackage = () => {
    if (!selected) return

    protectedAction.trigger({
      actionKind: 'package.export',
      actionTitle: 'Export Team Package',
      actionDescription: `Export ${selected.name} as .clawpack.zip`,
      entityName: selected.name,
      onConfirm: async (typedConfirmText) => {
        const blob = await packagesApi.export(selected.id, 'team_with_workflows', typedConfirmText)
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `${selected.slug || selected.id}.clawpack.zip`
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        URL.revokeObjectURL(url)
        setNotice('Team package exported')
      },
      onError: (err) => setError(err.message),
    })
  }

  if (loading) {
    return <div className="p-6 text-sm text-fg-2">Loading teams…</div>
  }

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm text-fg-2">{teams.length} teams configured</div>
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
            <Button type="button" onClick={openCreate} variant="primary" size="sm">
              <Plus className="w-3.5 h-3.5" />
              New Team
            </Button>
          </div>
        </div>

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
            columns={teamColumns}
            rows={teams}
            rowKey={(row) => row.id}
            onRowClick={(row) => setSelectedId(row.id)}
            selectedKey={selectedId ?? undefined}
            density="compact"
            emptyState={
              <EmptyState
                title="No teams"
                description="Create a team to group agents and linked workflows."
              />
            }
          />
        </div>
      </div>

      <RightDrawer
        open={Boolean(selected)}
        onClose={() => setSelectedId(null)}
        title={selected?.name || 'Team'}
        description={selected?.description || selected?.slug || ''}
      >
        {selected && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded bg-bg-2 p-2"><span className="text-fg-2">Members:</span> <span className="text-fg-1">{selected.memberCount}</span></div>
              <div className="rounded bg-bg-2 p-2"><span className="text-fg-2">Health:</span> <span className="text-fg-1">{selected.healthStatus}</span></div>
              <div className="rounded bg-bg-2 p-2"><span className="text-fg-2">Workflows:</span> <span className="text-fg-1">{selected.workflowIds.length}</span></div>
              <div className="rounded bg-bg-2 p-2"><span className="text-fg-2">Templates:</span> <span className="text-fg-1">{selected.templateIds.length}</span></div>
            </div>

            <div className="space-y-1">
              <div className="text-xs text-fg-2">Workflow IDs</div>
              <div className="text-xs text-fg-1 font-mono">{selected.workflowIds.join(', ') || 'none'}</div>
            </div>

            <div className="space-y-1">
              <div className="text-xs text-fg-2">Template IDs</div>
              <div className="text-xs text-fg-1 font-mono">{selected.templateIds.join(', ') || 'none'}</div>
            </div>

            <div className="space-y-1">
              <div className="text-xs text-fg-2">Members</div>
              <div className="space-y-1">
                {selected.members.map((member) => (
                  <div key={member.id} className="text-xs text-fg-1 rounded bg-bg-2 px-2 py-1">
                    {member.displayName} · {member.role}
                  </div>
                ))}
                {selected.members.length === 0 && (
                  <div className="text-xs text-fg-2">No members assigned</div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button type="button" onClick={openEdit} variant="secondary" size="sm">Edit</Button>
              <Button type="button" onClick={exportTeam} variant="secondary" size="sm">
                <Download className="w-3.5 h-3.5" />
                Export
              </Button>
              <Button type="button" onClick={exportTeamPackage} variant="secondary" size="sm">
                <Download className="w-3.5 h-3.5" />
                Export Package
              </Button>
              <Button type="button" onClick={deleteTeam} variant="danger" size="sm">
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </Button>
            </div>
          </div>
        )}
      </RightDrawer>

      <TeamEditorModal
        open={showEditor}
        mode={editorMode}
        draft={draft}
        workflows={workflowOptions}
        templates={templateOptions}
        optionsLoading={editorOptionsLoading}
        optionsError={editorOptionsError}
        onClose={() => setShowEditor(false)}
        onChange={setDraft}
        onSubmit={saveTeam}
        isSubmitting={isSubmitting}
      />

      <ImportPackageModal
        open={showPackageImport}
        onClose={() => setShowPackageImport(false)}
        onDeployed={fetchTeams}
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
