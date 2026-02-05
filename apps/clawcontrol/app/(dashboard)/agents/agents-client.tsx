'use client'

import { useState, useEffect, useRef } from 'react'
import { PageHeader, PageSection, EmptyState } from '@clawcontrol/ui'
import { CanonicalTable, type Column } from '@/components/ui/canonical-table'
import { StatusPill } from '@/components/ui/status-pill'
import { RightDrawer } from '@/components/shell/right-drawer'
import { useProtectedActionTrigger } from '@/components/protected-action-modal'
import { AgentAvatar } from '@/components/ui/agent-avatar'
import { ModelBadge, ModelOption } from '@/components/ui/model-badge'
import { AgentCard } from '@/components/agent-card'
import { StationIcon } from '@/components/station-icon'
import { FileEditorModal } from '@/components/file-editor-modal'
import { SkillSelector } from '@/components/skill-selector'
import { agentsApi, operationsApi, templatesApi, skillsApi, type TemplateSummary, type SkillSummary } from '@/lib/http'
import { AVAILABLE_MODELS, DEFAULT_MODEL } from '@/lib/models'
import type { AgentDTO, OperationDTO } from '@/lib/repo'
import { useStations } from '@/lib/stations-context'
import { cn } from '@/lib/utils'
import { StationsTab, StationUpsertModal } from './stations-tab'
import {
  Bot,
  Plus,
  Loader2,
  X,
  Check,
  Zap,
  MessageSquare,
  LayoutTemplate,
  ChevronRight,
  ChevronLeft,
  FileCode,
  Eye,
  LayoutGrid,
  List,
  Upload,
  RotateCcw,
  FileText,
  Sparkles,
  ChevronDown,
} from 'lucide-react'
import type { StatusTone } from '@clawcontrol/ui/theme'

// ============================================================================
// CONSTANTS
// ============================================================================

const ROLE_OPTIONS = [
  { value: 'spec', label: 'Specification', description: 'Requirements & specs' },
  { value: 'build', label: 'Build', description: 'Implementation & coding' },
  { value: 'qa', label: 'QA', description: 'Testing & quality' },
  { value: 'ops', label: 'Operations', description: 'Deployment & monitoring' },
  { value: 'review', label: 'Review', description: 'Code review' },
  { value: 'ship', label: 'Ship', description: 'Release & deploy' },
  { value: 'compound', label: 'Compound', description: 'Learning & docs' },
  { value: 'update', label: 'Update', description: 'Dependencies & maintenance' },
]

const CAPABILITY_OPTIONS = [
  'read_code',
  'write_code',
  'run_tests',
  'deploy',
  'review',
  'git',
  'database',
  'api',
]

// ============================================================================
// TABLE COLUMNS
// ============================================================================

const agentColumns: Column<AgentDTO>[] = [
  {
    key: 'name',
    header: 'Agent',
    width: '180px',
    mono: true,
    render: (row) => (
      <div className="flex items-center gap-2">
        <AgentAvatar agentId={row.id} name={row.name} size="sm" />
        <StationIcon stationId={row.station} />
        <span className="text-status-progress">{row.name}</span>
      </div>
    ),
  },
  {
    key: 'model',
    header: 'Model',
    width: '90px',
    render: (row) => <ModelBadge modelId={row.model} size="sm" />,
  },
  {
    key: 'role',
    header: 'Role',
    render: (row) => (
      <span className="text-fg-1 truncate max-w-[200px] inline-block">{row.role}</span>
    ),
  },
  {
    key: 'station',
    header: 'Station',
    width: '100px',
    render: (row) => (
      <span className="px-2 py-0.5 text-xs bg-bg-3 rounded text-fg-1 inline-flex items-center gap-1.5">
        <StationIcon stationId={row.station} />
        {row.station}
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    width: '90px',
    render: (row) => {
      const toneMap: Record<string, StatusTone> = {
        active: 'success',
        idle: 'muted',
        blocked: 'warning',
        error: 'danger',
      }
      return <StatusPill tone={toneMap[row.status]} label={row.status} />
    },
  },
  {
    key: 'wipLimit',
    header: 'WIP',
    width: '60px',
    align: 'center',
    mono: true,
    render: (row) => <span>{row.wipLimit}</span>,
  },
  {
    key: 'lastSeenAt',
    header: 'Last Seen',
    width: '100px',
    align: 'right',
    render: (row) => (
      <span className="text-fg-2 text-xs">
        {row.lastSeenAt ? formatRelativeTime(row.lastSeenAt) : 'Never'}
      </span>
    ),
  },
]

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function AgentsClient() {
  const [agents, setAgents] = useState<AgentDTO[]>([])
  const [operations, setOperations] = useState<OperationDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | undefined>()

  const { stations } = useStations()

  // Tab state
  const [activeTab, setActiveTab] = useState<'agents' | 'stations'>('agents')

  // View mode state
  const [viewMode, setViewMode] = useState<'list' | 'card'>('card')

  // Create agent modal state
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createResult, setCreateResult] = useState<{ success: boolean; message: string } | null>(null)

  // Create from template wizard state
  const [showTemplateWizard, setShowTemplateWizard] = useState(false)

  // File editor modal state
  const [editingFile, setEditingFile] = useState<{ agentName: string; fileName: string } | null>(null)

  const triggerProtectedAction = useProtectedActionTrigger()

  // Fetch agents and operations on mount
  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    try {
      setLoading(true)
      const [agentsResult, opsResult] = await Promise.all([
        agentsApi.list(),
        operationsApi.list(),
      ])
      setAgents(agentsResult.data)
      setOperations(opsResult.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agents')
    } finally {
      setLoading(false)
    }
  }

  const selectedAgent = selectedId ? agents.find((a) => a.id === selectedId) : undefined
  const _activeCount = agents.filter((a) => a.status === 'active').length

  const assignedOps = selectedAgent
    ? operations.filter((op) => op.assigneeAgentIds.includes(selectedAgent.id))
    : []

  // Handle provision agent
  const handleProvisionAgent = (agent: AgentDTO) => {
    triggerProtectedAction({
      actionKind: 'agent.provision',
      actionTitle: 'Provision Agent',
      actionDescription: `Provision ${agent.name} in OpenClaw gateway`,
      entityName: agent.name,
      onConfirm: async (typedConfirmText) => {
        try {
          await agentsApi.provision(agent.id, typedConfirmText)
          setCreateResult({ success: true, message: `Agent ${agent.name} provisioned successfully` })
        } catch (err) {
          setCreateResult({
            success: false,
            message: err instanceof Error ? err.message : 'Failed to provision agent',
          })
          throw err
        }
      },
      onError: (err) => {
        setCreateResult({ success: false, message: err.message })
      },
    })
  }

  // Handle test agent
  const handleTestAgent = async (agent: AgentDTO) => {
    try {
      const result = await agentsApi.test(agent.id, 'Hello from clawcontrol!')
      setCreateResult({
        success: true,
        message: `Test successful: ${result.data.response} (${result.data.latencyMs}ms)`,
      })
    } catch (err) {
      setCreateResult({
        success: false,
        message: err instanceof Error ? err.message : 'Test failed',
      })
    }
  }

  const handleEditAgent = (agent: AgentDTO, patch: {
    role?: string
    station?: string
    wipLimit?: number
    capabilities?: Record<string, boolean>
    sessionKey?: string
    model?: string
    fallbacks?: string[]
  }) => {
    triggerProtectedAction({
      actionKind: 'agent.edit',
      actionTitle: 'Edit Agent',
      actionDescription: `Update configuration for ${agent.name}`,
      entityName: agent.name,
      onConfirm: async (typedConfirmText) => {
        await agentsApi.update(agent.id, {
          ...patch,
          typedConfirmText,
        })
        await fetchData()
        setCreateResult({ success: true, message: `Updated ${agent.name}` })
      },
      onError: (err) => {
        setCreateResult({ success: false, message: err.message })
      },
    })
  }

  // Handle avatar upload
  const handleAvatarUpload = (agent: AgentDTO, file: File) => {
    triggerProtectedAction({
      actionKind: 'agent.edit',
      actionTitle: 'Upload Avatar',
      actionDescription: `Upload custom avatar for ${agent.name}`,
      entityName: agent.name,
      onConfirm: async (typedConfirmText) => {
        const reader = new FileReader()
        reader.onload = async () => {
          const base64 = (reader.result as string).split(',')[1]
          await fetch(`/api/agents/${agent.id}/avatar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: base64, typedConfirmText }),
          })
          await fetchData()
          setCreateResult({ success: true, message: 'Avatar uploaded' })
        }
        reader.readAsDataURL(file)
      },
      onError: (err) => {
        setCreateResult({ success: false, message: err.message })
      },
    })
  }

  // Handle avatar reset
  const handleAvatarReset = (agent: AgentDTO) => {
    triggerProtectedAction({
      actionKind: 'agent.edit',
      actionTitle: 'Reset Avatar',
      actionDescription: `Reset avatar to default identicon for ${agent.name}`,
      entityName: agent.name,
      onConfirm: async (typedConfirmText) => {
        await fetch(`/api/agents/${agent.id}/avatar?typedConfirmText=${encodeURIComponent(typedConfirmText)}`, {
          method: 'DELETE',
        })
        await fetchData()
        setCreateResult({ success: true, message: 'Avatar reset to default' })
      },
      onError: (err) => {
        setCreateResult({ success: false, message: err.message })
      },
    })
  }

  // Handle duplicate skills to agent
  const handleDuplicateSkills = (agent: AgentDTO, skillIds: string[]) => {
    triggerProtectedAction({
      actionKind: 'skill.duplicate_to_agent',
      actionTitle: 'Duplicate Skills',
      actionDescription: `Duplicate ${skillIds.length} skill(s) to ${agent.name}`,
      onConfirm: async (typedConfirmText) => {
        for (const skillId of skillIds) {
          await skillsApi.duplicate('global', skillId, {
            targetScope: 'agent',
            targetAgentId: agent.id,
            typedConfirmText,
          })
        }
        setCreateResult({ success: true, message: `Duplicated ${skillIds.length} skill(s)` })
      },
      onError: (err) => {
        setCreateResult({ success: false, message: err.message })
      },
    })
  }

  // Handle file edit
  const handleFileEdit = (agentName: string, fileName: string) => {
    setEditingFile({ agentName, fileName })
  }

  // Handle file saved (called by FileEditorModal after successful save)
  const handleFileSaved = () => {
    setEditingFile(null)
    setCreateResult({ success: true, message: 'File saved' })
  }

  // Handle create agent
  const handleCreateAgent = (formData: CreateAgentFormData) => {
    triggerProtectedAction({
      actionKind: 'agent.create',
      actionTitle: 'Create Agent',
      actionDescription: `Create new agent "${formData.role}" with name claw${formData.role.toUpperCase()}`,
      onConfirm: async (typedConfirmText) => {
        try {
          const result = await agentsApi.create({
            role: formData.role,
            purpose: formData.purpose,
            capabilities: formData.capabilities,
            typedConfirmText,
          })

          setCreateResult({ success: true, message: `Agent ${result.data.name} created successfully` })
          setShowCreateModal(false)

          // Refresh agents list
          await fetchData()
        } catch (err) {
          setCreateResult({
            success: false,
            message: err instanceof Error ? err.message : 'Failed to create agent',
          })
          throw err
        }
      },
      onError: (err) => {
        setCreateResult({ success: false, message: err.message })
      },
    })
  }

  // Handle create from template
  const handleCreateFromTemplate = (templateId: string, params: Record<string, unknown>) => {
    triggerProtectedAction({
      actionKind: 'agent.create_from_template',
      actionTitle: 'Create Agent from Template',
      actionDescription: `Create new agent from template "${templateId}"`,
      onConfirm: async (typedConfirmText) => {
        try {
          const result = await agentsApi.createFromTemplate({
            templateId,
            params,
            typedConfirmText,
          })

          setCreateResult({ success: true, message: `Agent ${result.data.name} created from template successfully` })
          setShowTemplateWizard(false)

          // Refresh agents list
          await fetchData()
        } catch (err) {
          setCreateResult({
            success: false,
            message: err instanceof Error ? err.message : 'Failed to create agent from template',
          })
          throw err
        }
      },
      onError: (err) => {
        setCreateResult({ success: false, message: err.message })
      },
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-fg-2" />
      </div>
    )
  }

  if (error) {
    return (
      <EmptyState
        icon={<Bot className="w-8 h-8" />}
        title="Error loading agents"
        description={error}
      />
    )
  }

  return (
    <>
      <div className="w-full space-y-4">
        <PageHeader
          title="Agents"
          subtitle={activeTab === 'agents' ? `${agents.length} agents configured` : `${stations.length} stations configured`}
          actions={
            <div className="flex items-center gap-2">
              {/* Tab Switch */}
              <div className="flex items-center gap-1 bg-bg-2 rounded-[var(--radius-md)] border border-bd-0 p-0.5">
                <button
                  onClick={() => setActiveTab('agents')}
                  className={cn(
                    'px-2.5 py-1.5 text-xs font-medium rounded-[var(--radius-sm)] transition-colors',
                    activeTab === 'agents'
                      ? 'bg-bg-3 text-fg-0'
                      : 'text-fg-2 hover:text-fg-1'
                  )}
                >
                  Agents
                </button>
                <button
                  onClick={() => setActiveTab('stations')}
                  className={cn(
                    'px-2.5 py-1.5 text-xs font-medium rounded-[var(--radius-sm)] transition-colors',
                    activeTab === 'stations'
                      ? 'bg-bg-3 text-fg-0'
                      : 'text-fg-2 hover:text-fg-1'
                  )}
                >
                  Stations
                </button>
              </div>

              {activeTab === 'agents' && (
                <>
                  {/* View Toggle */}
                  <div className="flex rounded-[var(--radius-md)] border border-bd-0 overflow-hidden">
                    <button
                      onClick={() => setViewMode('card')}
                      className={cn(
                        'p-1.5 transition-colors',
                        viewMode === 'card'
                          ? 'bg-status-progress text-white'
                          : 'bg-bg-2 text-fg-2 hover:text-fg-0'
                      )}
                      title="Card view"
                    >
                      <LayoutGrid className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setViewMode('list')}
                      className={cn(
                        'p-1.5 transition-colors',
                        viewMode === 'list'
                          ? 'bg-status-progress text-white'
                          : 'bg-bg-2 text-fg-2 hover:text-fg-0'
                      )}
                      title="List view"
                    >
                      <List className="w-4 h-4" />
                    </button>
                  </div>

                  <button
                    onClick={() => setShowTemplateWizard(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] border border-bd-0 text-fg-1 hover:bg-bg-3 transition-colors"
                  >
                    <LayoutTemplate className="w-3.5 h-3.5" />
                    From Template
                  </button>
                  <button
                    onClick={() => setShowCreateModal(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-status-progress text-white hover:bg-status-progress/90 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Create Agent
                  </button>
                </>
              )}
            </div>
          }
        />

        {activeTab === 'agents' && createResult && (
          <div
            className={cn(
              'flex items-center justify-between p-3 rounded-[var(--radius-md)] border',
              createResult.success
                ? 'bg-status-success/10 border-status-success/30 text-status-success'
                : 'bg-status-danger/10 border-status-danger/30 text-status-danger'
            )}
          >
            <div className="flex items-center gap-2">
              {createResult.success ? (
                <Check className="w-4 h-4" />
              ) : (
                <X className="w-4 h-4" />
              )}
              <span className="text-sm">{createResult.message}</span>
            </div>
            <button
              onClick={() => setCreateResult(null)}
              className="p-1 hover:bg-bg-3/50 rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {activeTab === 'stations' ? (
          <StationsTab />
        ) : (
          <>
            {/* Content: Card View or Table View */}
            {viewMode === 'card' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {agents.length === 0 ? (
                  <div className="col-span-full">
                    <EmptyState
                      icon={<Bot className="w-8 h-8" />}
                      title="No agents discovered"
                      description="Check OpenClaw connection."
                    />
                  </div>
                ) : (
                  agents.map((agent) => (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      onProvision={() => handleProvisionAgent(agent)}
                      onTest={() => handleTestAgent(agent)}
                      onEditFile={(fileName) => handleFileEdit(agent.name, fileName)}
                      onClick={() => setSelectedId(agent.id)}
                    />
                  ))
                )}
              </div>
            ) : (
              <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0 overflow-hidden">
                <CanonicalTable
                  columns={agentColumns}
                  rows={agents}
                  rowKey={(row) => row.id}
                  onRowClick={(row) => setSelectedId(row.id)}
                  selectedKey={selectedId}
                  density="compact"
                  emptyState={
                    <EmptyState
                      icon={<Bot className="w-8 h-8" />}
                      title="No agents discovered"
                      description="Check OpenClaw connection."
                    />
                  }
                />
              </div>
            )}
          </>
        )}
      </div>

      {activeTab === 'agents' && (
        <>
          {/* Create Agent Modal */}
          <CreateAgentModal
            isOpen={showCreateModal}
            onClose={() => setShowCreateModal(false)}
            onSubmit={handleCreateAgent}
          />

          {/* Create from Template Wizard */}
          <CreateFromTemplateWizard
            isOpen={showTemplateWizard}
            onClose={() => setShowTemplateWizard(false)}
            onSubmit={handleCreateFromTemplate}
          />

          {/* File Editor Modal */}
          {editingFile && (
            <FileEditorModal
              isOpen={!!editingFile}
              onClose={() => setEditingFile(null)}
              filePath={`agents/${editingFile.agentName}/${editingFile.fileName}`}
              fileName={editingFile.fileName}
              onSaved={handleFileSaved}
            />
          )}

          {/* Detail Drawer */}
          <RightDrawer
            open={!!selectedAgent}
            onClose={() => setSelectedId(undefined)}
            title={selectedAgent?.name}
            description={selectedAgent?.role}
          >
            {selectedAgent && (
              <AgentDetail
                agent={selectedAgent}
                assignedOps={assignedOps}
                onProvision={() => handleProvisionAgent(selectedAgent)}
                onTest={() => handleTestAgent(selectedAgent)}
                onEdit={(patch) => handleEditAgent(selectedAgent, patch)}
                onAvatarUpload={(file) => handleAvatarUpload(selectedAgent, file)}
                onAvatarReset={() => handleAvatarReset(selectedAgent)}
                onDuplicateSkills={(skillIds) => handleDuplicateSkills(selectedAgent, skillIds)}
                onEditFile={(fileName) => handleFileEdit(selectedAgent.name, fileName)}
              />
            )}
          </RightDrawer>
        </>
      )}
    </>
  )
}

// ============================================================================
// CREATE AGENT MODAL
// ============================================================================

interface CreateAgentFormData {
  role: string
  purpose: string
  capabilities: string[]
}

function CreateAgentModal({
  isOpen,
  onClose,
  onSubmit,
}: {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: CreateAgentFormData) => void
}) {
  const [role, setRole] = useState('')
  const [purpose, setPurpose] = useState('')
  const [capabilities, setCapabilities] = useState<string[]>([])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!role || !purpose) return

    onSubmit({ role, purpose, capabilities })
  }

  const toggleCapability = (cap: string) => {
    setCapabilities((prev) =>
      prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]
    )
  }

  const selectedRole = ROLE_OPTIONS.find((r) => r.value === role)
  const previewName = role ? `claw${role.toUpperCase()}` : 'claw...'

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-bg-1 rounded-[var(--radius-lg)] border border-bd-0 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-bd-0">
          <div>
            <h2 className="text-lg font-semibold text-fg-0">Create Agent</h2>
            <p className="text-sm text-fg-2">Configure a new agent for your workspace</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-bg-3 rounded-[var(--radius-md)] text-fg-2"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Name Preview */}
          <div className="p-4 bg-bg-3 rounded-[var(--radius-md)] border border-bd-0">
            <div className="flex items-center gap-3">
              <Bot className="w-8 h-8 text-status-progress" />
              <div>
                <p className="font-mono text-lg text-fg-0">{previewName}</p>
                <p className="text-xs text-fg-2">Auto-generated from role</p>
              </div>
            </div>
          </div>

          {/* Role Selection */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-fg-1">Role</label>
            <div className="grid grid-cols-2 gap-2">
              {ROLE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setRole(opt.value)}
                  className={cn(
                    'p-3 text-left rounded-[var(--radius-md)] border transition-colors',
                    role === opt.value
                      ? 'border-status-progress bg-status-progress/10'
                      : 'border-bd-0 hover:border-bd-1'
                  )}
                >
                  <p className={cn(
                    'text-sm font-medium',
                    role === opt.value ? 'text-status-progress' : 'text-fg-1'
                  )}>
                    {opt.label}
                  </p>
                  <p className="text-xs text-fg-2">{opt.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Purpose */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-fg-1">Purpose</label>
            <textarea
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="Describe what this agent will do..."
              rows={3}
              className="w-full px-3 py-2 bg-bg-2 border border-bd-0 rounded-[var(--radius-md)] text-sm text-fg-0 placeholder:text-fg-3 focus:outline-none focus:border-status-progress resize-none"
            />
          </div>

          {/* Capabilities */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-fg-1">Capabilities</label>
            <div className="flex flex-wrap gap-2">
              {CAPABILITY_OPTIONS.map((cap) => (
                <button
                  key={cap}
                  type="button"
                  onClick={() => toggleCapability(cap)}
                  className={cn(
                    'px-3 py-1.5 text-xs rounded-full border transition-colors',
                    capabilities.includes(cap)
                      ? 'border-status-progress bg-status-progress/10 text-status-progress'
                      : 'border-bd-0 text-fg-2 hover:border-bd-1'
                  )}
                >
                  {cap}
                </button>
              ))}
            </div>
          </div>

          {/* Station Info */}
          {selectedRole && (
            <div className="flex items-center gap-2 text-sm text-fg-2">
              <span>Station:</span>
              <span className="px-2 py-0.5 bg-bg-3 rounded text-fg-1">
                {selectedRole.value === 'review' ? 'qa' : selectedRole.value}
              </span>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-bd-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-fg-1 bg-bg-3 rounded-[var(--radius-md)] hover:bg-bg-3/80 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!role || !purpose}
              className="px-4 py-2 text-sm font-medium text-white bg-status-progress rounded-[var(--radius-md)] hover:bg-status-progress/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create Agent
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ============================================================================
// CREATE FROM TEMPLATE WIZARD
// ============================================================================

type WizardStep = 'select' | 'params' | 'preview' | 'confirm'

function CreateFromTemplateWizard({
  isOpen,
  onClose,
  onSubmit,
}: {
  isOpen: boolean
  onClose: () => void
  onSubmit: (templateId: string, params: Record<string, unknown>) => void
}) {
  const [step, setStep] = useState<WizardStep>('select')
  const [templates, setTemplates] = useState<TemplateSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Selected template state
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [templateInfo, setTemplateInfo] = useState<{
    paramsSchema: {
      type: 'object'
      properties?: Record<string, { type: string; description?: string; default?: unknown; enum?: unknown[] }>
      required?: string[]
    } | null
    defaults: Record<string, unknown>
    renderTargets: Array<{ source: string; destination: string }>
  } | null>(null)

  // Params state
  const [params, setParams] = useState<Record<string, unknown>>({})

  // Preview state
  const [previewFiles, setPreviewFiles] = useState<Array<{
    source: string
    destination: string
    contentPreview: string
  }>>([])

  // Fetch templates on open
  useEffect(() => {
    if (isOpen) {
      fetchTemplates()
      // Reset state
      setStep('select')
      setSelectedTemplateId(null)
      setTemplateInfo(null)
      setParams({})
      setPreviewFiles([])
      setError(null)
    }
  }, [isOpen])

  async function fetchTemplates() {
    setLoading(true)
    try {
      const result = await templatesApi.list()
      // Only show valid templates
      setTemplates(result.data.filter((t) => t.isValid))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load templates')
    } finally {
      setLoading(false)
    }
  }

  async function handleSelectTemplate(templateId: string) {
    setSelectedTemplateId(templateId)
    setLoading(true)
    setError(null)

    try {
      const result = await agentsApi.getTemplatePreview(templateId)
      setTemplateInfo({
        paramsSchema: result.data.paramsSchema,
        defaults: result.data.defaults,
        renderTargets: result.data.renderTargets,
      })
      // Initialize params with defaults
      setParams(result.data.defaults)
      setStep('params')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load template')
    } finally {
      setLoading(false)
    }
  }

  function handleParamChange(key: string, value: unknown) {
    setParams((prev) => ({ ...prev, [key]: value }))
  }

  function handleProceedToPreview() {
    // Validate required params
    if (templateInfo?.paramsSchema?.required) {
      const missing = templateInfo.paramsSchema.required.filter(
        (key) => !params[key] || params[key] === ''
      )
      if (missing.length > 0) {
        setError(`Missing required parameters: ${missing.join(', ')}`)
        return
      }
    }
    setError(null)

    // Mock preview data - in a real implementation, you'd call a preview API
    const previewData = templateInfo?.renderTargets?.map((target) => ({
      source: target.source,
      destination: target.destination.replace(/\{\{(\w+)\}\}/g, (_, key) =>
        String(params[key] || `{{${key}}}`)
      ),
      contentPreview: `# Preview of ${target.source}\n\nParameters will be rendered here...`,
    })) || []

    setPreviewFiles(previewData)
    setStep('preview')
  }

  function handleConfirm() {
    if (!selectedTemplateId) return
    onSubmit(selectedTemplateId, params)
  }

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId)

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-2xl bg-bg-1 rounded-[var(--radius-lg)] border border-bd-0 shadow-xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-bd-0 shrink-0">
          <div className="flex items-center gap-3">
            <LayoutTemplate className="w-5 h-5 text-status-progress" />
            <div>
              <h2 className="text-lg font-semibold text-fg-0">Create Agent from Template</h2>
              <p className="text-sm text-fg-2">
                {step === 'select' && 'Select a template to get started'}
                {step === 'params' && `Configure ${selectedTemplate?.name || 'template'}`}
                {step === 'preview' && 'Preview generated files'}
                {step === 'confirm' && 'Confirm creation'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-bg-3 rounded-[var(--radius-md)] text-fg-2">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-bd-0 shrink-0">
          {(['select', 'params', 'preview'] as WizardStep[]).map((s, idx) => (
            <div key={s} className="flex items-center">
              {idx > 0 && <ChevronRight className="w-4 h-4 text-fg-3 mx-1" />}
              <span
                className={cn(
                  'px-3 py-1 text-xs font-medium rounded-full',
                  step === s
                    ? 'bg-status-progress text-white'
                    : 'bg-bg-3 text-fg-2'
                )}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </span>
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {error && (
            <div className="mb-4 p-3 bg-status-danger/10 border border-status-danger/30 rounded-[var(--radius-md)] text-sm text-status-danger">
              {error}
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="w-6 h-6 animate-spin text-fg-2" />
            </div>
          )}

          {!loading && step === 'select' && (
            <div className="space-y-3">
              {templates.length === 0 ? (
                <EmptyState
                  icon={<LayoutTemplate className="w-8 h-8" />}
                  title="No templates available"
                  description="Create a template first in the Templates section"
                />
              ) : (
                templates.map((template) => (
                  <button
                    key={template.id}
                    onClick={() => handleSelectTemplate(template.id)}
                    className={cn(
                      'w-full p-4 text-left rounded-[var(--radius-md)] border transition-colors',
                      selectedTemplateId === template.id
                        ? 'border-status-progress bg-status-progress/5'
                        : 'border-bd-0 hover:border-bd-1'
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-fg-0">{template.name}</p>
                        <p className="text-sm text-fg-2 mt-1">{template.description}</p>
                      </div>
                      <span className="px-2 py-0.5 text-xs bg-bg-3 rounded text-fg-1">
                        {template.role}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}

          {!loading && step === 'params' && templateInfo && (
            <div className="space-y-4">
              {templateInfo.paramsSchema?.properties ? (
                Object.entries(templateInfo.paramsSchema.properties).map(([key, prop]) => {
                  const isRequired = templateInfo.paramsSchema?.required?.includes(key)
                  return (
                    <div key={key} className="space-y-2">
                      <label className="flex items-center gap-2 text-sm font-medium text-fg-1">
                        {key}
                        {isRequired && <span className="text-status-danger">*</span>}
                      </label>
                      {prop.description && (
                        <p className="text-xs text-fg-2">{prop.description}</p>
                      )}
                      {prop.enum ? (
                        <select
                          value={String(params[key] || '')}
                          onChange={(e) => handleParamChange(key, e.target.value)}
                          className="w-full px-3 py-2 bg-bg-2 border border-bd-0 rounded-[var(--radius-md)] text-sm text-fg-0"
                        >
                          <option value="">Select...</option>
                          {prop.enum.map((val) => (
                            <option key={String(val)} value={String(val)}>
                              {String(val)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={String(params[key] || '')}
                          onChange={(e) => handleParamChange(key, e.target.value)}
                          placeholder={prop.default ? String(prop.default) : ''}
                          className="w-full px-3 py-2 bg-bg-2 border border-bd-0 rounded-[var(--radius-md)] text-sm text-fg-0 placeholder:text-fg-3"
                        />
                      )}
                    </div>
                  )
                })
              ) : (
                <p className="text-sm text-fg-2">No parameters required for this template.</p>
              )}
            </div>
          )}

          {!loading && step === 'preview' && (
            <div className="space-y-4">
              <p className="text-sm text-fg-2">
                The following files will be created:
              </p>
              {previewFiles.map((file, idx) => (
                <div
                  key={idx}
                  className="p-4 bg-bg-2 rounded-[var(--radius-md)] border border-bd-0"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <FileCode className="w-4 h-4 text-fg-2" />
                    <span className="text-sm font-mono text-fg-1">{file.destination}</span>
                  </div>
                  <p className="text-xs text-fg-2">Source: {file.source}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-bd-0 shrink-0">
          <div>
            {step !== 'select' && (
              <button
                onClick={() => setStep(step === 'preview' ? 'params' : 'select')}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-fg-1 hover:bg-bg-3 rounded-[var(--radius-md)] transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-fg-1 bg-bg-3 rounded-[var(--radius-md)] hover:bg-bg-3/80 transition-colors"
            >
              Cancel
            </button>
            {step === 'params' && (
              <button
                onClick={handleProceedToPreview}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-status-progress rounded-[var(--radius-md)] hover:bg-status-progress/90 transition-colors"
              >
                Preview
                <Eye className="w-4 h-4" />
              </button>
            )}
            {step === 'preview' && (
              <button
                onClick={handleConfirm}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-status-progress rounded-[var(--radius-md)] hover:bg-status-progress/90 transition-colors"
              >
                Create Agent
                <Check className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// AGENT DETAIL
// ============================================================================

function AgentDetail({
  agent,
  assignedOps,
  onProvision,
  onTest,
  onEdit,
  onAvatarUpload,
  onAvatarReset,
  onDuplicateSkills,
  onEditFile,
}: {
  agent: AgentDTO
  assignedOps: OperationDTO[]
  onProvision: () => void
  onTest: () => void
  onEdit: (patch: {
    role?: string
    station?: string
    wipLimit?: number
    capabilities?: Record<string, boolean>
    sessionKey?: string
    model?: string
    fallbacks?: string[]
  }) => void
  onAvatarUpload: (file: File) => void
  onAvatarReset: () => void
  onDuplicateSkills: (skillIds: string[]) => void
  onEditFile: (fileName: string) => void
}) {
  const toneMap: Record<string, StatusTone> = {
    active: 'success',
    idle: 'muted',
    blocked: 'warning',
    error: 'danger',
  }

  const { stations, stationsById } = useStations()

  const [editRole, setEditRole] = useState(agent.role)
  const [editStation, setEditStation] = useState(agent.station)
  const [editWipLimit, setEditWipLimit] = useState<number>(agent.wipLimit)
  const [editSessionKey, setEditSessionKey] = useState(agent.sessionKey)
  const [editCaps, setEditCaps] = useState<Record<string, boolean>>(agent.capabilities)
  const [editModel, setEditModel] = useState(agent.model || DEFAULT_MODEL)
  const [editFallbacks, setEditFallbacks] = useState<string[]>(agent.fallbacks ?? [])
  const [showFallbackSelector, setShowFallbackSelector] = useState(false)
  const [showModelSelector, setShowModelSelector] = useState(false)
  const [showStationSelector, setShowStationSelector] = useState(false)
  const [showCreateStation, setShowCreateStation] = useState(false)

  // Skills state
  const [agentSkills, setAgentSkills] = useState<SkillSummary[]>([])
  const [loadingSkills, setLoadingSkills] = useState(false)
  const [showSkillSelector, setShowSkillSelector] = useState(false)

  // File input ref
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setEditRole(agent.role)
    setEditStation(agent.station)
    setEditWipLimit(agent.wipLimit)
    setEditSessionKey(agent.sessionKey)
    setEditCaps(agent.capabilities)
    setEditModel(agent.model || DEFAULT_MODEL)
    setEditFallbacks((agent.fallbacks ?? []).filter((m) => m !== (agent.model || DEFAULT_MODEL)))
    setShowFallbackSelector(false)
    setShowStationSelector(false)
    loadAgentSkills()
  }, [agent.id])

  async function loadAgentSkills() {
    setLoadingSkills(true)
    try {
      const result = await skillsApi.list({ scope: 'agent', agentId: agent.id })
      setAgentSkills(result.data)
    } catch {
      // Ignore errors
    } finally {
      setLoadingSkills(false)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      onAvatarUpload(file)
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // Agent file names
  const agentFiles = [`${agent.name}.soul.md`, `${agent.name}.md`]
  const agentStationLabel = stationsById[agent.station]?.name ?? agent.station
  const editStationLabel = stationsById[editStation]?.name ?? editStation
  const sortedStations = [...stations].sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name))

  return (
    <div className="space-y-6">
      {/* Avatar Section */}
      <div className="flex items-center gap-4">
        <AgentAvatar agentId={agent.id} name={agent.name} size="xl" />
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-bg-3 text-fg-1 hover:bg-bg-3/80 transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />
              Upload
            </button>
            <button
              onClick={onAvatarReset}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-bg-3 text-fg-2 hover:text-fg-1 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>
          </div>
          <p className="text-xs text-fg-3">PNG, JPG, or WebP. Max 2MB.</p>
        </div>
      </div>

      {/* Status */}
      <div className="flex items-center gap-3">
        <StatusPill tone={toneMap[agent.status]} label={agent.status} />
        <span className="px-2 py-0.5 text-xs bg-bg-3 rounded text-fg-1 inline-flex items-center gap-1.5">
          <StationIcon stationId={agent.station} />
          {agentStationLabel}
        </span>
        <ModelBadge modelId={agent.model} size="sm" showIcon />
      </div>

      {/* Actions */}
      <PageSection title="Actions">
        <div className="flex gap-2">
          <button
            onClick={onProvision}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-status-warning/10 text-status-warning border border-status-warning/30 hover:bg-status-warning/20 transition-colors"
          >
            <Zap className="w-3.5 h-3.5" />
            Provision
          </button>
          <button
            onClick={onTest}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-status-progress/10 text-status-progress border border-status-progress/30 hover:bg-status-progress/20 transition-colors"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Test
          </button>
        </div>
      </PageSection>

      {/* Files */}
      <PageSection title="Agent Files">
        <div className="flex flex-wrap gap-2">
          {agentFiles.map((fileName) => (
            <button
              key={fileName}
              onClick={() => onEditFile(fileName)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-[var(--radius-md)] bg-bg-3 text-fg-1 hover:bg-bg-3/80 border border-bd-0 transition-colors"
            >
              <FileText className="w-3.5 h-3.5 text-fg-2" />
              {fileName}
            </button>
          ))}
        </div>
      </PageSection>

      {/* Skills */}
      <PageSection title="Skills" description={`${agentSkills.length} agent-scoped skills`}>
        <div className="space-y-2">
          {loadingSkills ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-4 h-4 animate-spin text-fg-2" />
            </div>
          ) : agentSkills.length === 0 ? (
            <p className="text-xs text-fg-3">No skills assigned to this agent</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {agentSkills.map((skill) => (
                <span
                  key={skill.id}
                  className="px-2 py-1 text-xs bg-status-progress/10 text-status-progress rounded border border-status-progress/20"
                >
                  {skill.name}
                </span>
              ))}
            </div>
          )}
          <button
            onClick={() => setShowSkillSelector(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-bg-3 text-fg-1 hover:bg-bg-3/80 transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Add Skills from Global
          </button>
        </div>
      </PageSection>

      {/* Skill Selector Modal */}
      <SkillSelector
        isOpen={showSkillSelector}
        onClose={() => setShowSkillSelector(false)}
        agentId={agent.id}
        agentName={agent.name}
        onSelectSkills={(skillIds) => {
          setShowSkillSelector(false)
          onDuplicateSkills(skillIds)
        }}
      />

      {/* Current Work */}
      <PageSection
        title="Current Work"
        description={`${assignedOps.filter((op) => op.status === 'in_progress').length} in progress`}
      >
        <div className="space-y-2">
          {assignedOps.map((op) => (
            <div
              key={op.id}
              className="flex items-center justify-between p-3 bg-bg-3 rounded-[var(--radius-md)] border border-bd-0"
            >
              <div className="min-w-0">
                <p className="text-sm text-fg-0 truncate">{op.title}</p>
                <p className="text-xs text-fg-2">{op.station}</p>
              </div>
              <span className={cn(
                'text-xs font-medium px-2 py-0.5 rounded',
                op.status === 'done' && 'bg-status-success/10 text-status-success',
                op.status === 'in_progress' && 'bg-status-progress/10 text-status-progress',
                op.status === 'blocked' && 'bg-status-danger/10 text-status-danger'
              )}>
                {op.status.replace('_', ' ')}
              </span>
            </div>
          ))}
          {assignedOps.length === 0 && (
            <p className="text-sm text-fg-2">No assigned operations</p>
          )}
        </div>
      </PageSection>

      {/* Capabilities */}
      <PageSection title="Capabilities">
        <div className="flex flex-wrap gap-2">
          {Object.entries(agent.capabilities)
            .filter(([_, enabled]) => enabled)
            .map(([cap]) => (
              <span
                key={cap}
                className="px-2 py-1 text-xs bg-bg-3 rounded text-fg-1 border border-bd-0"
              >
                {cap}
              </span>
            ))}
        </div>
      </PageSection>

      {/* Metadata */}
      <PageSection title="Details">
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-fg-2">WIP Limit</dt>
          <dd className="text-fg-1 font-mono">{agent.wipLimit}</dd>
          <dt className="text-fg-2">Session Key</dt>
          <dd className="text-fg-1 font-mono text-xs truncate">{agent.sessionKey}</dd>
          <dt className="text-fg-2">Last Heartbeat</dt>
          <dd className="text-fg-1 font-mono text-xs">
            {agent.lastHeartbeatAt ? formatRelativeTime(agent.lastHeartbeatAt) : 'Never'}
          </dd>
          <dt className="text-fg-2">Registered</dt>
          <dd className="text-fg-1 font-mono text-xs">{new Date(agent.createdAt).toLocaleDateString()}</dd>
        </dl>
      </PageSection>

      {/* Edit */}
      <PageSection title="Edit Configuration" description="Requires typed confirmation">
        <div className="space-y-3">
          {/* Model Selection */}
          <div className="space-y-2">
            <label className="text-xs text-fg-2">AI Model</label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowModelSelector(!showModelSelector)}
                className="w-full flex items-center justify-between px-3 py-2 bg-bg-2 border border-bd-0 rounded-[var(--radius-md)] text-sm text-fg-0 hover:border-bd-1 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <ModelBadge modelId={editModel} size="sm" />
                  <span>{AVAILABLE_MODELS.find((m) => m.id === editModel)?.name || 'Unknown'}</span>
                </div>
                <ChevronDown className={cn('w-4 h-4 text-fg-2 transition-transform', showModelSelector && 'rotate-180')} />
              </button>
              {showModelSelector && (
                <div className="absolute z-10 mt-1 w-full bg-bg-1 border border-bd-0 rounded-[var(--radius-md)] shadow-lg overflow-hidden">
                  {AVAILABLE_MODELS.map((model) => (
                    <ModelOption
                      key={model.id}
                      modelId={model.id}
                      selected={editModel === model.id}
                      onClick={() => {
                        setEditModel(model.id)
                        setEditFallbacks((prev) => prev.filter((m) => m !== model.id))
                        setShowModelSelector(false)
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Fallbacks */}
          <div className="space-y-2">
            <label className="text-xs text-fg-2">Fallbacks</label>

            <div className="flex flex-wrap gap-2">
              {editFallbacks.length === 0 ? (
                <span className="text-xs text-fg-3">None</span>
              ) : (
                editFallbacks.map((fb, idx) => (
                  <span
                    key={`${fb}-${idx}`}
                    className="inline-flex items-center gap-1.5 px-2 py-1 bg-bg-3 rounded-[var(--radius-md)] border border-bd-0"
                  >
                    <ModelBadge modelId={fb} size="sm" />

                    <button
                      type="button"
                      onClick={() => {
                        if (idx === 0) return
                        setEditFallbacks((prev) => {
                          const next = [...prev]
                          const tmp = next[idx - 1]
                          next[idx - 1] = next[idx]
                          next[idx] = tmp
                          return next
                        })
                      }}
                      className={cn(
                        'px-1 py-0.5 text-xs rounded bg-bg-2 border border-bd-0 hover:border-bd-1',
                        idx === 0 && 'opacity-40 pointer-events-none'
                      )}
                      title="Move up"
                    >
                      ↑
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (idx === editFallbacks.length - 1) return
                        setEditFallbacks((prev) => {
                          const next = [...prev]
                          const tmp = next[idx + 1]
                          next[idx + 1] = next[idx]
                          next[idx] = tmp
                          return next
                        })
                      }}
                      className={cn(
                        'px-1 py-0.5 text-xs rounded bg-bg-2 border border-bd-0 hover:border-bd-1',
                        idx === editFallbacks.length - 1 && 'opacity-40 pointer-events-none'
                      )}
                      title="Move down"
                    >
                      ↓
                    </button>

                    <button
                      type="button"
                      onClick={() => setEditFallbacks((prev) => prev.filter((_, i) => i !== idx))}
                      className="px-1 py-0.5 text-xs rounded bg-bg-2 border border-bd-0 hover:border-bd-1"
                      title="Remove"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))
              )}
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => setShowFallbackSelector(!showFallbackSelector)}
                className="w-full flex items-center justify-between px-3 py-2 bg-bg-2 border border-bd-0 rounded-[var(--radius-md)] text-sm text-fg-0 hover:border-bd-1 transition-colors"
              >
                <span className="text-xs text-fg-2">Add fallback…</span>
                <ChevronDown
                  className={cn('w-4 h-4 text-fg-2 transition-transform', showFallbackSelector && 'rotate-180')}
                />
              </button>

              {showFallbackSelector && (
                <div className="absolute z-10 mt-1 w-full bg-bg-1 border border-bd-0 rounded-[var(--radius-md)] shadow-lg overflow-hidden">
                  {AVAILABLE_MODELS
                    .filter((m) => m.id !== editModel)
                    .filter((m) => !editFallbacks.includes(m.id))
                    .map((m) => (
                      <ModelOption
                        key={m.id}
                        modelId={m.id}
                        selected={false}
                        onClick={() => {
                          setEditFallbacks((prev) => [...prev, m.id])
                          setShowFallbackSelector(false)
                        }}
                      />
                    ))}

                  {AVAILABLE_MODELS.filter((m) => m.id !== editModel).filter((m) => !editFallbacks.includes(m.id)).length === 0 && (
                    <div className="px-3 py-2 text-xs text-fg-3">No more models available</div>
                  )}
                </div>
              )}
            </div>

            <p className="text-[11px] text-fg-3">Tried in order if primary fails. Stored as a JSON array of model IDs.</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs text-fg-2">Role</label>
              <input
                value={editRole}
                onChange={(e) => setEditRole(e.target.value)}
                className="w-full px-2 py-1.5 bg-bg-2 border border-bd-0 rounded-[var(--radius-md)] text-sm text-fg-0"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-fg-2">Station</label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowStationSelector(!showStationSelector)}
                  className="w-full flex items-center justify-between px-3 py-2 bg-bg-2 border border-bd-0 rounded-[var(--radius-md)] text-sm text-fg-0 hover:border-bd-1 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <StationIcon stationId={editStation} />
                    <span className="truncate">{editStationLabel}</span>
                  </div>
                  <ChevronDown className={cn('w-4 h-4 text-fg-2 transition-transform', showStationSelector && 'rotate-180')} />
                </button>
                {showStationSelector && (
                  <div className="absolute z-10 mt-1 w-full bg-bg-1 border border-bd-0 rounded-[var(--radius-md)] shadow-lg overflow-hidden">
                    {sortedStations.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setEditStation(s.id)
                          setShowStationSelector(false)
                        }}
                        className={cn(
                          'w-full px-3 py-2 text-left text-xs hover:bg-bg-2 transition-colors flex items-center justify-between gap-2',
                          s.id === editStation && 'bg-status-progress/10'
                        )}
                      >
                        <span className="inline-flex items-center gap-2 min-w-0">
                          <StationIcon stationId={s.id} />
                          <span className="truncate">{s.name}</span>
                        </span>
                        <span className="text-[10px] text-fg-3 font-mono">{s.id}</span>
                      </button>
                    ))}
                    <div className="border-t border-bd-0">
                      <button
                        type="button"
                        onClick={() => {
                          setShowStationSelector(false)
                          setShowCreateStation(true)
                        }}
                        className="w-full px-3 py-2 text-left text-xs hover:bg-bg-2 transition-colors text-status-progress"
                      >
                        + Create new…
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs text-fg-2">WIP Limit</label>
              <input
                type="number"
                value={editWipLimit}
                onChange={(e) => setEditWipLimit(parseInt(e.target.value || '0', 10))}
                className="w-full px-2 py-1.5 bg-bg-2 border border-bd-0 rounded-[var(--radius-md)] text-sm text-fg-0"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-fg-2">Session Key</label>
              <input
                value={editSessionKey}
                onChange={(e) => setEditSessionKey(e.target.value)}
                className="w-full px-2 py-1.5 bg-bg-2 border border-bd-0 rounded-[var(--radius-md)] text-sm text-fg-0 font-mono"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs text-fg-2">Capabilities</label>
            <div className="flex flex-wrap gap-2">
              {CAPABILITY_OPTIONS.map((cap) => (
                <button
                  key={cap}
                  type="button"
                  onClick={() => setEditCaps((prev) => ({ ...prev, [cap]: !prev[cap] }))}
                  className={cn(
                    'px-2 py-1 text-xs rounded border transition-colors',
                    editCaps[cap]
                      ? 'bg-status-progress/10 text-status-progress border-status-progress/30'
                      : 'bg-bg-3 text-fg-2 border-bd-0 hover:border-bd-1'
                  )}
                >
                  {cap}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-2">
            <button
              onClick={() => onEdit({
                role: editRole,
                station: editStation,
                wipLimit: editWipLimit,
                sessionKey: editSessionKey,
                capabilities: editCaps,
                model: editModel,
                fallbacks: editFallbacks,
              })}
              className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-status-warning/10 text-status-warning border border-status-warning/30 hover:bg-status-warning/20 transition-colors"
            >
              Save Changes
            </button>
          </div>
        </div>
      </PageSection>

      <StationUpsertModal
        open={showCreateStation}
        mode="create"
        onClose={() => setShowCreateStation(false)}
        onSuccess={(s) => {
          setShowCreateStation(false)
          setEditStation(s.id)
        }}
      />
    </div>
  )
}

// ============================================================================
// UTILS
// ============================================================================

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
