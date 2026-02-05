'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { PageHeader, PageSection, EmptyState, TypedConfirmModal } from '@clawcontrol/ui'
import { CanonicalTable, type Column } from '@/components/ui/canonical-table'
import { StatusPill } from '@/components/ui/status-pill'
import { RightDrawer } from '@/components/shell/right-drawer'
import { MarkdownEditor } from '@/components/editors'
import { useProtectedAction } from '@/lib/hooks/useProtectedAction'
import { skillsApi, type SkillWithContent, type SkillValidationResult, HttpError } from '@/lib/http'
import type { SkillDTO, AgentDTO } from '@/lib/data'
import { cn } from '@/lib/utils'
import {
  Sparkles,
  Plus,
  Trash2,
  Globe,
  User,
  Power,
  Loader2,
  Download,
  Copy,
  CheckCircle,
  AlertTriangle,
  XCircle,
  RefreshCw,
  X,
  ExternalLink,
  Upload,
} from 'lucide-react'

interface Props {
  skills: SkillDTO[]
  agents: AgentDTO[]
}

type TabScope = 'all' | 'global' | 'agent'

const scopeTabs: { id: TabScope; label: string; icon: typeof Globe }[] = [
  { id: 'all', label: 'All', icon: Sparkles },
  { id: 'global', label: 'Global', icon: Globe },
  { id: 'agent', label: 'Agent', icon: User },
]

export function SkillsClient({ skills: initialSkills, agents }: Props) {
  const [skills, setSkills] = useState(initialSkills)
  const [activeTab, setActiveTab] = useState<TabScope>('all')
  const [selectedSkill, setSelectedSkill] = useState<SkillWithContent | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isValidating, setIsValidating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [skillContent, setSkillContent] = useState<string>('')
  const [showDuplicateModal, setShowDuplicateModal] = useState(false)
  const [duplicateTarget, setDuplicateTarget] = useState<{
    scope: 'global' | 'agent'
    agentId?: string
  }>({ scope: 'global' })
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)

  const protectedAction = useProtectedAction()

  // Filter skills by scope
  const filteredSkills = activeTab === 'all'
    ? skills
    : skills.filter((s) => s.scope === activeTab)

  const globalCount = skills.filter((s) => s.scope === 'global').length
  const agentCount = skills.filter((s) => s.scope === 'agent').length
  const enabledCount = skills.filter((s) => s.enabled).length

  // Refresh skills list
  const refreshSkills = useCallback(async () => {
    try {
      const result = await skillsApi.list()
      setSkills(result.data)
    } catch (err) {
      console.error('Failed to refresh skills:', err)
    }
  }, [])

  const handleUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadFile(file)
    setShowUploadModal(true)

    // Allow selecting the same file again later.
    e.target.value = ''
  }, [])

  // Handle skill click - open in drawer
  const handleSkillClick = useCallback(async (skill: SkillDTO) => {
    setIsLoading(true)
    setError(null)

    try {
      const result = await skillsApi.get(skill.scope, skill.id)
      setSelectedSkill(result.data)
      setSkillContent(result.data.skillMd)
    } catch (err) {
      console.error('Failed to load skill:', err)
      setError(err instanceof Error ? err.message : 'Failed to load skill')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Handle save with Governor gating
  const handleSave = useCallback(async (content: string): Promise<void> => {
    if (!selectedSkill) return

    return new Promise((resolve, reject) => {
      protectedAction.trigger({
        actionKind: 'skill.edit',
        actionTitle: 'Edit Skill',
        actionDescription: `You are editing the "${selectedSkill.name}" skill. Changes will take effect immediately.`,
        onConfirm: async (typedConfirmText) => {
          setIsSaving(true)
          setError(null)

          try {
            const result = await skillsApi.update(selectedSkill.scope, selectedSkill.id, {
              skillMd: content,
              typedConfirmText,
            })
            setSelectedSkill(result.data)
            setSkillContent(content)
            resolve()
          } catch (err) {
            console.error('Failed to save skill:', err)
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
  }, [selectedSkill, protectedAction])

  // Handle enable/disable
  const handleToggleEnabled = useCallback(async () => {
    if (!selectedSkill) return

    const newEnabled = !selectedSkill.enabled
    const hasValidationErrors = selectedSkill.validation?.status === 'invalid'

    // If trying to enable an invalid skill, use danger-level action
    const actionKind = newEnabled && hasValidationErrors
      ? 'skill.enable_invalid'
      : newEnabled
        ? 'skill.enable'
        : 'skill.disable'

    protectedAction.trigger({
      actionKind,
      actionTitle: newEnabled ? 'Enable Skill' : 'Disable Skill',
      actionDescription: hasValidationErrors && newEnabled
        ? `WARNING: This skill has validation errors. Enabling it anyway may cause issues. Are you sure you want to enable "${selectedSkill.name}"?`
        : `You are ${newEnabled ? 'enabling' : 'disabling'} the "${selectedSkill.name}" skill.`,
      onConfirm: async (typedConfirmText) => {
        setIsSaving(true)
        setError(null)

        try {
          const result = await skillsApi.update(selectedSkill.scope, selectedSkill.id, {
            enabled: newEnabled,
            typedConfirmText,
          })
          setSelectedSkill(result.data)

          // Update skills list
          setSkills((prev) =>
            prev.map((s) =>
              s.id === selectedSkill.id ? { ...s, enabled: newEnabled } : s
            )
          )
        } catch (err) {
          console.error('Failed to toggle skill:', err)
          if (err instanceof HttpError) {
            setError(err.message)
          }
        } finally {
          setIsSaving(false)
        }
      },
      onError: (err) => {
        setError(err.message)
      },
    })
  }, [selectedSkill, protectedAction])

  // Handle uninstall
  const handleUninstall = useCallback(async () => {
    if (!selectedSkill) return

    protectedAction.trigger({
      actionKind: 'skill.uninstall',
      actionTitle: 'Uninstall Skill',
      actionDescription: `You are about to uninstall the "${selectedSkill.name}" skill. This action cannot be undone.`,
      onConfirm: async (typedConfirmText) => {
        setIsSaving(true)
        setError(null)

        try {
          await skillsApi.uninstall(selectedSkill.scope, selectedSkill.id, typedConfirmText)

          // Remove from skills list
          setSkills((prev) => prev.filter((s) => s.id !== selectedSkill.id))

          // Close drawer
          setSelectedSkill(null)
        } catch (err) {
          console.error('Failed to uninstall skill:', err)
          if (err instanceof HttpError) {
            setError(err.message)
          }
        } finally {
          setIsSaving(false)
        }
      },
      onError: (err) => {
        setError(err.message)
      },
    })
  }, [selectedSkill, protectedAction])

  // Handle validate
  const handleValidate = useCallback(async () => {
    if (!selectedSkill) return

    setIsValidating(true)
    setError(null)

    try {
      const result = await skillsApi.validate(selectedSkill.scope, selectedSkill.id)
      setSelectedSkill((prev) =>
        prev ? { ...prev, validation: result.data.validation } : null
      )
    } catch (err) {
      console.error('Failed to validate skill:', err)
      if (err instanceof HttpError) {
        setError(err.message)
      }
    } finally {
      setIsValidating(false)
    }
  }, [selectedSkill])

  // Handle export
  const handleExport = useCallback(async () => {
    if (!selectedSkill) return

    try {
      const blob = await skillsApi.export(selectedSkill.scope, selectedSkill.id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${selectedSkill.name}-${selectedSkill.version}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Failed to export skill:', err)
      if (err instanceof HttpError) {
        setError(err.message)
      }
    }
  }, [selectedSkill])

  // Handle duplicate
  const handleDuplicate = useCallback(async () => {
    if (!selectedSkill) return

    const actionKind = duplicateTarget.scope === 'global'
      ? 'skill.duplicate_to_global'
      : 'skill.duplicate_to_agent'

    protectedAction.trigger({
      actionKind,
      actionTitle: 'Duplicate Skill',
      actionDescription: duplicateTarget.scope === 'global'
        ? `You are copying "${selectedSkill.name}" to global scope. This will make it available to all agents.`
        : `You are copying "${selectedSkill.name}" to agent scope.`,
      onConfirm: async (typedConfirmText) => {
        setIsSaving(true)
        setError(null)

        try {
          const result = await skillsApi.duplicate(selectedSkill.scope, selectedSkill.id, {
            targetScope: duplicateTarget.scope,
            targetAgentId: duplicateTarget.agentId,
            typedConfirmText,
          })

          // Add to skills list
          setSkills((prev) => [...prev, result.data])
          setShowDuplicateModal(false)
        } catch (err) {
          console.error('Failed to duplicate skill:', err)
          if (err instanceof HttpError) {
            setError(err.message)
          }
        } finally {
          setIsSaving(false)
        }
      },
      onError: (err) => {
        setError(err.message)
      },
    })
  }, [selectedSkill, duplicateTarget, protectedAction])

  const skillColumns: Column<SkillDTO>[] = [
    {
      key: 'name',
      header: 'Skill',
      width: '160px',
      mono: true,
      render: (row) => (
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'w-2 h-2 rounded-full',
              row.enabled ? 'bg-status-success' : 'bg-fg-3'
            )}
          />
          <span className="text-fg-0">{row.name}</span>
          {row.validation && (
            <ValidationIcon status={row.validation.status} />
          )}
        </div>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      render: (row) => (
        <span className="text-fg-1 truncate max-w-[200px] inline-block">
          {row.description}
        </span>
      ),
    },
    {
      key: 'scope',
      header: 'Scope',
      width: '120px',
      render: (row) => (
        <div className="flex items-center gap-1.5">
          {row.scope === 'global' ? (
            <>
              <Globe className="w-3.5 h-3.5 text-fg-2" />
              <span className="text-fg-1">Global</span>
            </>
          ) : (
            <>
              <User className="w-3.5 h-3.5 text-fg-2" />
              <span className="text-fg-1 font-mono text-xs">{row.agentName}</span>
            </>
          )}
        </div>
      ),
    },
    {
      key: 'version',
      header: 'Version',
      width: '80px',
      mono: true,
      render: (row) => <span className="text-fg-2">{row.version}</span>,
    },
    {
      key: 'enabled',
      header: 'Status',
      width: '90px',
      render: (row) => (
        <StatusPill
          tone={row.enabled ? 'success' : 'muted'}
          label={row.enabled ? 'Enabled' : 'Disabled'}
        />
      ),
    },
    {
      key: 'usageCount',
      header: 'Uses',
      width: '70px',
      align: 'right',
      mono: true,
    },
  ]

  return (
    <>
      <div className="w-full space-y-4">
        <PageHeader
          title="Skills"
          subtitle={`${skills.length} skills • ${enabledCount} enabled`}
          actions={
            <div className="flex items-center gap-2">
              <a
                href="https://github.com/openclaw/skills"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm bg-bg-2 text-fg-1 hover:bg-bg-3 border border-bd-0 rounded-[var(--radius-md)]"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Find Skills
              </a>
              <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm bg-bg-2 text-fg-1 hover:bg-bg-3 border border-bd-0 rounded-[var(--radius-md)] cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                Upload Skill
                <input
                  type="file"
                  accept=".zip"
                  className="hidden"
                  onChange={handleUpload}
                />
              </label>
              <button
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm bg-status-info text-bg-0 hover:bg-status-info/90 rounded-[var(--radius-md)]"
              >
                <Plus className="w-3.5 h-3.5" />
                Create Skill
              </button>
            </div>
          }
        />

        {/* Scope Tabs */}
        <div className="flex items-center gap-1 p-1 bg-bg-2 rounded-[var(--radius-md)] border border-bd-0 w-fit">
          {scopeTabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-[var(--radius-sm)] transition-colors',
                activeTab === id
                  ? 'bg-bg-1 text-fg-0 shadow-sm'
                  : 'text-fg-2 hover:text-fg-1'
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
              <span className="text-xs text-fg-3 ml-1">
                {id === 'all' ? skills.length : id === 'global' ? globalCount : agentCount}
              </span>
            </button>
          ))}
        </div>

        {/* Skills Table */}
        <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0 overflow-hidden">
          <CanonicalTable
            columns={skillColumns}
            rows={filteredSkills}
            rowKey={(row) => row.id}
            onRowClick={(row) => handleSkillClick(row)}
            selectedKey={selectedSkill?.id}
            density="compact"
            emptyState={
              <EmptyState
                icon={<Sparkles className="w-8 h-8" />}
                title={activeTab === 'all' ? 'No skills installed' : `No ${activeTab} skills`}
                description={
                  activeTab === 'agent'
                    ? 'Agent-scoped skills are only available to specific agents'
                    : 'Skills extend agent capabilities'
                }
              />
            }
          />
        </div>
      </div>

      {/* Detail Drawer */}
      <RightDrawer
        open={!!selectedSkill}
        onClose={() => {
          setSelectedSkill(null)
          setError(null)
          setShowDuplicateModal(false)
        }}
        title={selectedSkill?.name ?? ''}
        description={selectedSkill?.description}
        width="lg"
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-6 h-6 animate-spin text-fg-2" />
          </div>
        ) : selectedSkill ? (
          <div className="space-y-6">
            {/* Header Info */}
            <div className="pb-4 border-b border-bd-0">
              <div className="flex items-center gap-3 mb-4">
                <StatusPill
                  tone={selectedSkill.enabled ? 'success' : 'muted'}
                  label={selectedSkill.enabled ? 'Enabled' : 'Disabled'}
                />
                <span className="font-mono text-xs text-fg-2">
                  v{selectedSkill.version}
                </span>
                <div className="flex items-center gap-1 text-fg-2">
                  {selectedSkill.scope === 'global' ? (
                    <>
                      <Globe className="w-3.5 h-3.5" />
                      <span className="text-xs">Global</span>
                    </>
                  ) : (
                    <>
                      <User className="w-3.5 h-3.5" />
                      <span className="text-xs font-mono">{selectedSkill.agentName}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Actions - grid layout for consistent sizing */}
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={handleToggleEnabled}
                  disabled={isSaving}
                  className="inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs bg-bg-3 border border-bd-0 rounded-[var(--radius-md)] text-fg-1 hover:bg-bg-2 transition-colors disabled:opacity-50"
                >
                  <Power className="w-3.5 h-3.5" />
                  {selectedSkill.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  onClick={handleValidate}
                  disabled={isValidating}
                  className="inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs bg-bg-3 border border-bd-0 rounded-[var(--radius-md)] text-fg-1 hover:bg-bg-2 transition-colors disabled:opacity-50"
                >
                  {isValidating ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  Validate
                </button>
                <button
                  onClick={handleExport}
                  disabled={isSaving}
                  className="inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs bg-bg-3 border border-bd-0 rounded-[var(--radius-md)] text-fg-1 hover:bg-bg-2 transition-colors disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export
                </button>
                <button
                  onClick={() => setShowDuplicateModal(true)}
                  disabled={isSaving}
                  className="inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs bg-bg-3 border border-bd-0 rounded-[var(--radius-md)] text-fg-1 hover:bg-bg-2 transition-colors disabled:opacity-50"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Duplicate
                </button>
                <button
                  onClick={handleUninstall}
                  disabled={isSaving}
                  className="col-span-2 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs bg-bg-3 border border-bd-0 rounded-[var(--radius-md)] text-status-danger hover:bg-status-danger/10 transition-colors disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Uninstall
                </button>
              </div>
            </div>

            {/* Validation Status */}
            {selectedSkill.validation && (
              <ValidationPanel validation={selectedSkill.validation} />
            )}

            {/* Duplicate Modal */}
            {showDuplicateModal && (
              <div className="p-4 bg-bg-3 rounded-[var(--radius-md)] border border-bd-0">
                <h4 className="text-sm font-medium text-fg-0 mb-3">Duplicate to:</h4>
                <div className="space-y-3">
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="duplicateScope"
                        checked={duplicateTarget.scope === 'global'}
                        onChange={() => setDuplicateTarget({ scope: 'global' })}
                        className="text-accent"
                      />
                      <Globe className="w-4 h-4 text-fg-2" />
                      <span className="text-sm text-fg-1">Global</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="duplicateScope"
                        checked={duplicateTarget.scope === 'agent'}
                        onChange={() => setDuplicateTarget({ scope: 'agent', agentId: agents[0]?.id })}
                        className="text-accent"
                      />
                      <User className="w-4 h-4 text-fg-2" />
                      <span className="text-sm text-fg-1">Agent</span>
                    </label>
                  </div>
                  {duplicateTarget.scope === 'agent' && (
                    <select
                      value={duplicateTarget.agentId}
                      onChange={(e) => setDuplicateTarget({ scope: 'agent', agentId: e.target.value })}
                      className="w-full px-3 py-2 bg-bg-2 border border-bd-0 rounded-[var(--radius-md)] text-sm text-fg-1"
                    >
                      {agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={handleDuplicate}
                      disabled={isSaving}
                      className="px-3 py-1.5 bg-accent text-white text-sm rounded-[var(--radius-md)] hover:bg-accent/90 disabled:opacity-50"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setShowDuplicateModal(false)}
                      className="px-3 py-1.5 bg-bg-2 border border-bd-0 text-sm text-fg-1 rounded-[var(--radius-md)] hover:bg-bg-1"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Skill Editor */}
            <PageSection title="skill.md" description="Skill definition and documentation">
              <MarkdownEditor
                value={skillContent}
                onChange={setSkillContent}
                onSave={handleSave}
                filePath={`skills/${selectedSkill.scope}/${selectedSkill.name}/skill.md`}
                isSaving={isSaving}
                error={error}
                height="calc(100vh - 500px)"
              />
            </PageSection>

            {/* Usage Stats */}
            <PageSection title="Usage">
              <dl className="grid grid-cols-2 gap-2 text-sm p-4 bg-bg-3 rounded-[var(--radius-md)]">
                <dt className="text-fg-2">Total Uses</dt>
                <dd className="text-fg-1 font-mono">{selectedSkill.usageCount}</dd>
                <dt className="text-fg-2">Last Used</dt>
                <dd className="text-fg-1 font-mono text-xs">
                  {selectedSkill.lastUsedAt
                    ? formatRelativeTime(new Date(selectedSkill.lastUsedAt))
                    : 'Never'}
                </dd>
                <dt className="text-fg-2">Installed</dt>
                <dd className="text-fg-1 font-mono text-xs">
                  {new Date(selectedSkill.installedAt).toLocaleDateString()}
                </dd>
                <dt className="text-fg-2">Modified</dt>
                <dd className="text-fg-1 font-mono text-xs">
                  {formatRelativeTime(new Date(selectedSkill.modifiedAt))}
                </dd>
              </dl>
            </PageSection>
          </div>
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

      {/* Create Skill Modal */}
      <CreateSkillModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={refreshSkills}
        agents={agents}
        protectedAction={protectedAction}
      />

      {/* Upload Skill Modal */}
      <UploadSkillModal
        isOpen={showUploadModal}
        file={uploadFile}
        onClose={() => {
          setShowUploadModal(false)
          setUploadFile(null)
        }}
        onImported={refreshSkills}
        agents={agents}
        protectedAction={protectedAction}
      />
    </>
  )
}

// ============================================================================
// UPLOAD SKILL MODAL
// ============================================================================

interface UploadSkillModalProps {
  isOpen: boolean
  file: File | null
  onClose: () => void
  onImported: () => void
  agents: AgentDTO[]
  protectedAction: ReturnType<typeof useProtectedAction>
}

function UploadSkillModal({
  isOpen,
  file,
  onClose,
  onImported,
  agents,
  protectedAction,
}: UploadSkillModalProps) {
  const [scope, setScope] = useState<'global' | 'agent'>('global')
  const [agentId, setAgentId] = useState<string>('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      setScope('global')
      setAgentId('')
      setError(null)
      setIsSubmitting(false)
    }
  }, [isOpen])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isSubmitting) {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isSubmitting, onClose])

  const handleInstall = () => {
    if (!file) return
    if (scope === 'agent' && !agentId) {
      setError('Please select an agent')
      return
    }

    protectedAction.trigger({
      actionKind: 'skill.install',
      actionTitle: 'Import Skill',
      actionDescription: `Import a skill from "${file.name}" to ${scope} scope.`,
      onConfirm: async (typedConfirmText) => {
        setIsSubmitting(true)
        setError(null)

        try {
          await skillsApi.importZip({
            file,
            scope,
            agentId: scope === 'agent' ? agentId : undefined,
            typedConfirmText,
          })

          onImported()
          onClose()
        } catch (err) {
          if (err instanceof HttpError) {
            setError(err.message)
          } else {
            setError(err instanceof Error ? err.message : 'Failed to import skill')
          }
        } finally {
          setIsSubmitting(false)
        }
      },
      onError: (err) => setError(err.message),
    })
  }

  if (!isOpen || !file) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={!isSubmitting ? onClose : undefined}
      />

      {/* Modal */}
      <div className="relative bg-bg-1 border border-bd-1 rounded-[var(--radius-lg)] shadow-2xl w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-bd-0">
          <h2 className="text-base font-medium text-fg-0">Upload Skill</h2>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 text-fg-2 hover:text-fg-0 hover:bg-bg-3 rounded-[var(--radius-md)] transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* File */}
          <div>
            <div className="text-xs font-medium text-fg-1 mb-1.5">File</div>
            <div className="px-3 py-2 text-sm bg-bg-2 border border-bd-1 rounded-[var(--radius-md)] text-fg-0 font-mono">
              {file.name}
            </div>
          </div>

          {/* Scope */}
          <div>
            <label className="block text-xs font-medium text-fg-1 mb-1.5">
              Scope
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setScope('global')}
                disabled={isSubmitting}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-[var(--radius-md)] border transition-colors',
                  scope === 'global'
                    ? 'bg-status-info/10 text-status-info border-status-info/30'
                    : 'bg-bg-2 text-fg-1 border-bd-1 hover:border-bd-1'
                )}
              >
                <Globe className="w-4 h-4" />
                Global
              </button>
              <button
                type="button"
                onClick={() => setScope('agent')}
                disabled={isSubmitting}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-[var(--radius-md)] border transition-colors',
                  scope === 'agent'
                    ? 'bg-status-info/10 text-status-info border-status-info/30'
                    : 'bg-bg-2 text-fg-1 border-bd-1 hover:border-bd-1'
                )}
              >
                <User className="w-4 h-4" />
                Agent
              </button>
            </div>
          </div>

          {/* Agent Selector (only for agent scope) */}
          {scope === 'agent' && (
            <div>
              <label htmlFor="upload-skill-agent" className="block text-xs font-medium text-fg-1 mb-1.5">
                Agent
              </label>
              <select
                id="upload-skill-agent"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                disabled={isSubmitting}
                className="w-full px-3 py-2 text-sm bg-bg-2 border border-bd-1 rounded-[var(--radius-md)] text-fg-0 focus:outline-none focus:ring-1 focus:ring-status-info/50 disabled:opacity-50"
              >
                <option value="">Select an agent...</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="text-xs text-status-danger bg-status-danger/10 border border-status-danger/20 rounded-[var(--radius-md)] px-3 py-2">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-medium text-fg-1 hover:text-fg-0 bg-bg-3 rounded-[var(--radius-md)] border border-bd-0 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleInstall}
              disabled={isSubmitting || (scope === 'agent' && !agentId)}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-bg-0 bg-status-info hover:bg-status-info/90 rounded-[var(--radius-md)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isSubmitting ? 'Installing...' : 'Install'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// CREATE SKILL MODAL
// ============================================================================

interface CreateSkillModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void
  agents: AgentDTO[]
  protectedAction: ReturnType<typeof useProtectedAction>
}

function CreateSkillModal({
  isOpen,
  onClose,
  onCreated,
  agents,
  protectedAction,
}: CreateSkillModalProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [scope, setScope] = useState<'global' | 'agent'>('global')
  const [agentId, setAgentId] = useState<string>('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setName('')
      setDescription('')
      setScope('global')
      setAgentId('')
      setError(null)
      setTimeout(() => nameInputRef.current?.focus(), 100)
    }
  }, [isOpen])

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isSubmitting) {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isSubmitting, onClose])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Skill name is required')
      return
    }
    if (scope === 'agent' && !agentId) {
      setError('Please select an agent')
      return
    }

    // Trigger protected action confirmation
    protectedAction.trigger({
      actionKind: 'skill.install',
      actionTitle: 'Create Skill',
      actionDescription: `Create a new ${scope} skill named "${name}"`,
      onConfirm: async (typedConfirmText) => {
        setIsSubmitting(true)
        setError(null)

        try {
          await skillsApi.install({
            name: name.trim(),
            description: description.trim() || undefined,
            scope,
            agentId: scope === 'agent' ? agentId : undefined,
            typedConfirmText,
          })
          onCreated()
          onClose()
        } catch (err) {
          if (err instanceof HttpError) {
            setError(err.message)
          } else {
            setError(err instanceof Error ? err.message : 'Failed to create skill')
          }
        } finally {
          setIsSubmitting(false)
        }
      },
      onError: (err) => {
        setError(err.message)
      },
    })
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={!isSubmitting ? onClose : undefined}
      />

      {/* Modal */}
      <div className="relative bg-bg-1 border border-bd-1 rounded-[var(--radius-lg)] shadow-2xl w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-bd-0">
          <h2 className="text-base font-medium text-fg-0">Create New Skill</h2>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 text-fg-2 hover:text-fg-0 hover:bg-bg-3 rounded-[var(--radius-md)] transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label htmlFor="skill-name" className="block text-xs font-medium text-fg-1 mb-1.5">
              Name
            </label>
            <input
              ref={nameInputRef}
              id="skill-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., my-custom-skill"
              disabled={isSubmitting}
              className="w-full px-3 py-2 text-sm bg-bg-2 border border-bd-1 rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-2 focus:outline-none focus:ring-1 focus:ring-status-info/50 disabled:opacity-50"
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="skill-description" className="block text-xs font-medium text-fg-1 mb-1.5">
              Description (optional)
            </label>
            <textarea
              id="skill-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of what this skill does"
              rows={2}
              disabled={isSubmitting}
              className="w-full px-3 py-2 text-sm bg-bg-2 border border-bd-1 rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-2 focus:outline-none focus:ring-1 focus:ring-status-info/50 resize-none disabled:opacity-50"
            />
          </div>

          {/* Scope */}
          <div>
            <label className="block text-xs font-medium text-fg-1 mb-1.5">
              Scope
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setScope('global')}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-[var(--radius-md)] border transition-colors',
                  scope === 'global'
                    ? 'bg-status-info/10 text-status-info border-status-info/30'
                    : 'bg-bg-2 text-fg-1 border-bd-1 hover:border-bd-1'
                )}
              >
                <Globe className="w-4 h-4" />
                Global
              </button>
              <button
                type="button"
                onClick={() => setScope('agent')}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-[var(--radius-md)] border transition-colors',
                  scope === 'agent'
                    ? 'bg-status-info/10 text-status-info border-status-info/30'
                    : 'bg-bg-2 text-fg-1 border-bd-1 hover:border-bd-1'
                )}
              >
                <User className="w-4 h-4" />
                Agent
              </button>
            </div>
          </div>

          {/* Agent Selector (only for agent scope) */}
          {scope === 'agent' && (
            <div>
              <label htmlFor="skill-agent" className="block text-xs font-medium text-fg-1 mb-1.5">
                Agent
              </label>
              <select
                id="skill-agent"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                disabled={isSubmitting}
                className="w-full px-3 py-2 text-sm bg-bg-2 border border-bd-1 rounded-[var(--radius-md)] text-fg-0 focus:outline-none focus:ring-1 focus:ring-status-info/50 disabled:opacity-50"
              >
                <option value="">Select an agent...</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="text-xs text-status-danger bg-status-danger/10 border border-status-danger/20 rounded-[var(--radius-md)] px-3 py-2">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-medium text-fg-1 hover:text-fg-0 bg-bg-3 rounded-[var(--radius-md)] border border-bd-0 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim() || (scope === 'agent' && !agentId)}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-bg-0 bg-status-info hover:bg-status-info/90 rounded-[var(--radius-md)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isSubmitting ? 'Creating...' : 'Create Skill'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ============================================================================
// VALIDATION COMPONENTS
// ============================================================================

function ValidationIcon({ status }: { status: string }) {
  switch (status) {
    case 'valid':
      return <CheckCircle className="w-3.5 h-3.5 text-status-success" />
    case 'warnings':
      return <AlertTriangle className="w-3.5 h-3.5 text-status-warning" />
    case 'invalid':
      return <XCircle className="w-3.5 h-3.5 text-status-danger" />
    default:
      return null
  }
}

function ValidationPanel({ validation }: { validation: SkillValidationResult }) {
  const statusColors = {
    valid: 'bg-status-success/10 border-status-success/20 text-status-success',
    warnings: 'bg-status-warning/10 border-status-warning/20 text-status-warning',
    invalid: 'bg-status-danger/10 border-status-danger/20 text-status-danger',
    unchecked: 'bg-fg-3/10 border-fg-3/20 text-fg-2',
  }

  return (
    <div className={cn('p-4 rounded-[var(--radius-md)] border', statusColors[validation.status])}>
      <div className="flex items-center gap-2 mb-2">
        <ValidationIcon status={validation.status} />
        <span className="text-sm font-medium">{validation.summary}</span>
      </div>

      {validation.errors.length > 0 && (
        <div className="mt-3">
          <h5 className="text-xs font-medium mb-1">Errors:</h5>
          <ul className="text-xs space-y-1">
            {validation.errors.map((err, i) => (
              <li key={i} className="flex items-start gap-1">
                <XCircle className="w-3 h-3 mt-0.5 shrink-0" />
                <span>
                  {err.path && <code className="font-mono">{err.path}: </code>}
                  {err.message}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {validation.warnings.length > 0 && (
        <div className="mt-3">
          <h5 className="text-xs font-medium mb-1">Warnings:</h5>
          <ul className="text-xs space-y-1">
            {validation.warnings.map((warn, i) => (
              <li key={i} className="flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                <span>
                  {warn.path && <code className="font-mono">{warn.path}: </code>}
                  {warn.message}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-2 text-xs opacity-70">
        Last validated: {formatRelativeTime(new Date(validation.validatedAt))}
      </div>
    </div>
  )
}

function formatRelativeTime(date: Date | string): string {
  const now = new Date()
  const d = typeof date === 'string' ? new Date(date) : date
  const diff = now.getTime() - d.getTime()
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}
