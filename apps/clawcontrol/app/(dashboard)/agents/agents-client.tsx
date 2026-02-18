'use client'

import { useCallback, useState, useEffect, useRef } from 'react'
import { PageHeader, PageSection, EmptyState, Button, SegmentedToggle, SelectDropdown } from '@clawcontrol/ui'
import { CanonicalTable, type Column } from '@/components/ui/canonical-table'
import { StatusPill } from '@/components/ui/status-pill'
import { LoadingSpinner, LoadingState } from '@/components/ui/loading-state'
import { RightDrawer } from '@/components/shell/right-drawer'
import { useProtectedActionTrigger } from '@/components/protected-action-modal'
import { AgentAvatar } from '@/components/ui/agent-avatar'
import { ModelBadge } from '@/components/ui/model-badge'
import { AgentCard } from '@/components/agent-card'
import { StationIcon } from '@/components/station-icon'
import { FileEditorModal } from '@/components/file-editor-modal'
import { SkillSelector } from '@/components/skill-selector'
import {
  agentsApi,
  modelsApi,
  templatesApi,
  skillsApi,
  type AgentHierarchyData,
  type ModelListItem,
  type TemplateSummary,
  type SkillSummary,
} from '@/lib/http'
import { AVAILABLE_MODELS, DEFAULT_MODEL, inferModelProvider } from '@/lib/models'
import type { AgentDTO, OperationDTO } from '@/lib/repo'
import { slugifyDisplayName } from '@/lib/agent-identity'
import { useStations } from '@/lib/stations-context'
import { cn } from '@/lib/utils'
import { usePageReadyTiming } from '@/lib/perf/client-timing'
import { AGENTS_TAB_STALE_TIME_MS, revalidateAgentsTabCache, useAgentsTabStore } from '@/lib/stores/agents-tab-store'
import { StationsTab, StationUpsertModal } from './stations-tab'
import { HierarchyView } from './hierarchy-view'
import { TeamsTab } from './teams-tab'
import { ProviderLogo } from '@/components/provider-logo'
import {
  AlertTriangle,
  Bot,
  Plus,
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
  Trash2,
  FileText,
  Sparkles,
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

interface AgentModelCatalogEntry {
  id: string
  name: string
  description: string
  provider: string
}

interface AgentKnownModelStatus {
  available: boolean
  missing: boolean
}

interface AgentModelCatalog {
  entries: AgentModelCatalogEntry[]
  statusById: Record<string, AgentKnownModelStatus>
}

const DEFAULT_AGENT_MODEL_CATALOG: AgentModelCatalog = {
  entries: AVAILABLE_MODELS.map((model) => ({
    id: model.id,
    name: model.name,
    description: model.description,
    provider: inferModelProvider(model.id),
  })),
  statusById: {},
}

function buildAgentModelCatalog(listedModels: ModelListItem[]): AgentModelCatalog {
  const entriesById = new Map<string, AgentModelCatalogEntry>(
    DEFAULT_AGENT_MODEL_CATALOG.entries.map((entry) => [entry.id, entry] as const)
  )
  const statusById: Record<string, AgentKnownModelStatus> = {}

  for (const listed of listedModels) {
    statusById[listed.key] = {
      available: listed.available,
      missing: listed.missing,
    }

    const existing = entriesById.get(listed.key)
    const provider = inferModelProvider(listed.key)
    const description = listed.missing || !listed.available
      ? 'Configured but unavailable for this provider'
      : existing?.description ?? listed.input ?? 'Configured model'

    if (existing) {
      entriesById.set(listed.key, {
        ...existing,
        description,
      })
      continue
    }

    entriesById.set(listed.key, {
      id: listed.key,
      name: listed.name || listed.key,
      description,
      provider,
    })
  }

  const curatedOrder = new Map<string, number>(
    AVAILABLE_MODELS.map((model, index) => [model.id, index] as const)
  )
  const entries = Array.from(entriesById.values()).sort((a, b) => {
    const aOrder = curatedOrder.get(a.id)
    const bOrder = curatedOrder.get(b.id)
    if (aOrder !== undefined && bOrder !== undefined) return aOrder - bOrder
    if (aOrder !== undefined) return -1
    if (bOrder !== undefined) return 1
    return a.name.localeCompare(b.name)
  })

  return { entries, statusById }
}

function buildAutoAgentName(role: string): string {
  const normalized = role
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `agent-${normalized || 'worker'}`
}

function buildAgentSlugPreview(displayName: string, role: string): string {
  const fallback = role ? buildAutoAgentName(role) : 'agent-worker'
  return slugifyDisplayName(displayName || fallback)
}

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
        <AgentAvatar agentId={row.id} name={row.displayName} size="sm" />
        <StationIcon stationId={row.station} />
        <span className="text-status-progress">{row.displayName}</span>
      </div>
    ),
  },
  {
    key: 'model',
    header: 'Model',
    width: '140px',
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
  const agents = useAgentsTabStore((state) => state.agents)
  const operations = useAgentsTabStore((state) => state.operations)
  const loading = useAgentsTabStore((state) => state.isLoading)
  const error = useAgentsTabStore((state) => state.error)
  const [selectedId, setSelectedId] = useState<string | undefined>()

  const { stations } = useStations()

  // Tab state
  const [activeTab, setActiveTab] = useState<'agents' | 'teams' | 'stations'>('agents')

  // View mode state
  const [agentView, setAgentView] = useState<'list' | 'hierarchy'>('list')
  const [listViewMode, setListViewMode] = useState<'list' | 'card'>('card')
  const [hierarchyData, setHierarchyData] = useState<AgentHierarchyData | null>(null)
  const [hierarchyLoading, setHierarchyLoading] = useState(false)
  const [hierarchyError, setHierarchyError] = useState<string | null>(null)

  // Create agent modal state
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createResult, setCreateResult] = useState<{ success: boolean; message: string } | null>(null)
  const [modelCatalog, setModelCatalog] = useState<AgentModelCatalog>(DEFAULT_AGENT_MODEL_CATALOG)
  const [modelCatalogLoading, setModelCatalogLoading] = useState(false)
  const [modelCatalogError, setModelCatalogError] = useState<string | null>(null)

  // Create from template wizard state
  const [showTemplateWizard, setShowTemplateWizard] = useState(false)

  // File editor modal state
  const [editingFile, setEditingFile] = useState<{ filePath: string; fileName: string } | null>(null)

  usePageReadyTiming('agents', !loading)

  const triggerProtectedAction = useProtectedActionTrigger()

  const fetchModelCatalog = useCallback(async () => {
    setModelCatalogLoading(true)
    setModelCatalogError(null)
    try {
      const response = await modelsApi.runAction('list')
      const listed = response.data as { count: number; models: ModelListItem[] }
      const models = Array.isArray(listed.models) ? listed.models : []
      setModelCatalog(buildAgentModelCatalog(models))
    } catch (err) {
      setModelCatalogError(err instanceof Error ? err.message : 'Failed to load model availability')
    } finally {
      setModelCatalogLoading(false)
    }
  }, [])

  // Fetch agents and operations on mount
  useEffect(() => {
    const snapshot = useAgentsTabStore.getState()
    const hasCache = snapshot.fetchedAt !== null
    const cacheAgeMs = hasCache ? Date.now() - Number(snapshot.fetchedAt) : Number.POSITIVE_INFINITY
    const forceRefresh = !hasCache || cacheAgeMs >= AGENTS_TAB_STALE_TIME_MS
    void fetchData({ force: forceRefresh, blocking: !hasCache })
    void fetchModelCatalog()
  }, [])

  useEffect(() => {
    if (activeTab !== 'agents') return
    if (agentView !== 'hierarchy') return
    if (hierarchyData || hierarchyLoading) return
    fetchHierarchy()
  }, [activeTab, agentView, hierarchyData, hierarchyLoading])

  useEffect(() => {
    if (agentView === 'hierarchy') {
      setSelectedId(undefined)
    }
  }, [agentView])

  async function fetchData(options?: { force?: boolean; blocking?: boolean }) {
    try {
      await revalidateAgentsTabCache({
        force: options?.force ?? true,
        blocking: options?.blocking ?? false,
      })
    } catch (err) {
      console.error('Failed to refresh agents cache:', err)
    } finally {
      if (agentView === 'hierarchy') {
        void fetchHierarchy()
      }
    }
  }

  async function fetchHierarchy() {
    try {
      setHierarchyLoading(true)
      setHierarchyError(null)
      const result = await agentsApi.hierarchy()
      setHierarchyData(result.data)
    } catch (err) {
      setHierarchyError(err instanceof Error ? err.message : 'Failed to load hierarchy')
    } finally {
      setHierarchyLoading(false)
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
      actionDescription: `Provision ${agent.displayName} in OpenClaw gateway`,
      entityName: agent.displayName,
      onConfirm: async (typedConfirmText) => {
        try {
          await agentsApi.provision(agent.id, typedConfirmText)
          setCreateResult({ success: true, message: `Agent ${agent.displayName} provisioned successfully` })
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
    displayName?: string
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
      actionDescription: `Update configuration for ${agent.displayName}`,
      entityName: agent.displayName,
      onConfirm: async (typedConfirmText) => {
        await agentsApi.update(agent.id, {
          ...patch,
          typedConfirmText,
        })
        await Promise.all([fetchData(), fetchModelCatalog()])
        setCreateResult({ success: true, message: `Updated ${agent.displayName}` })
      },
      onError: (err) => {
        setCreateResult({ success: false, message: err.message })
      },
    })
  }

  const handleDeleteAgent = (agent: AgentDTO) => {
    const isMain = (agent.slug ?? '').trim().toLowerCase() === 'main'
      || (agent.runtimeAgentId ?? '').trim().toLowerCase() === 'main'
      || agent.displayName.trim().toLowerCase() === 'main'
    if (isMain) {
      setCreateResult({ success: false, message: 'Main agent cannot be deleted' })
      return
    }

    triggerProtectedAction({
      actionKind: 'agent.delete',
      actionTitle: 'Delete Agent',
      actionDescription: `Delete ${agent.displayName} from ClawControl and OpenClaw`,
      entityName: agent.displayName,
      onConfirm: async (typedConfirmText) => {
        await agentsApi.delete(agent.id, typedConfirmText)
        if (selectedId === agent.id) {
          setSelectedId(undefined)
        }
        await fetchData()
        setCreateResult({ success: true, message: `Deleted ${agent.displayName}` })
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
      actionDescription: `Upload custom avatar for ${agent.displayName}`,
      entityName: agent.displayName,
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
      actionDescription: `Reset avatar to default identicon for ${agent.displayName}`,
      entityName: agent.displayName,
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
      actionDescription: `Duplicate ${skillIds.length} skill(s) to ${agent.displayName}`,
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
  const handleFileEdit = (filePath: string, fileName?: string) => {
    const parsedName = fileName || filePath.split('/').filter(Boolean).pop() || 'file'
    setEditingFile({ filePath, fileName: parsedName })
  }

  // Handle file saved (called by FileEditorModal after successful save)
  const handleFileSaved = () => {
    setEditingFile(null)
    setCreateResult({ success: true, message: 'File saved' })
  }

  // Handle create agent
  const handleCreateAgent = (formData: CreateAgentFormData) => {
    const resolvedDisplayName = formData.displayName || buildAutoAgentName(formData.role)
    const previewSlug = buildAgentSlugPreview(resolvedDisplayName, formData.role)

    triggerProtectedAction({
      actionKind: 'agent.create',
      actionTitle: 'Create Agent',
      actionDescription: `Create new agent "${resolvedDisplayName}" (${previewSlug})`,
      onConfirm: async (typedConfirmText) => {
        try {
          const result = await agentsApi.create({
            role: formData.role,
            purpose: formData.purpose,
            capabilities: formData.capabilities,
            displayName: formData.displayName || undefined,
            typedConfirmText,
          })

          setCreateResult({ success: true, message: `Agent ${result.data.displayName} created successfully` })
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
  const handleCreateFromTemplate = (
    templateId: string,
    params: Record<string, unknown>,
    displayName?: string
  ) => {
    triggerProtectedAction({
      actionKind: 'agent.create_from_template',
      actionTitle: 'Create Agent from Template',
      actionDescription: `Create new agent from template "${templateId}"`,
      onConfirm: async (typedConfirmText) => {
        try {
          const result = await agentsApi.createFromTemplate({
            templateId,
            params,
            displayName,
            typedConfirmText,
          })

          setCreateResult({ success: true, message: `Agent ${result.data.displayName} created from template successfully` })
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

  if (loading && agents.length === 0) {
    return <LoadingState height="viewport" />
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
      <div className={cn('relative w-full space-y-4', editingFile && 'min-h-[70vh]')}>
        <PageHeader
          title="Agents"
          subtitle={
            activeTab === 'agents'
              ? `${agents.length} agents configured`
              : activeTab === 'teams'
                ? 'Manage agent teams and linked workflows'
                : `${stations.length} stations configured`
          }
          actions={
            <div className="flex items-center gap-2">
              {/* Tab Switch */}
              <SegmentedToggle
                value={activeTab}
                onChange={setActiveTab}
                tone="neutral"
                ariaLabel="Agents section"
                items={[
                  { value: 'agents', label: 'Agents' },
                  { value: 'teams', label: 'Teams' },
                  { value: 'stations', label: 'Stations' },
                ]}
              />

              {activeTab === 'agents' && (
                <>
                  {/* Primary View Toggle */}
                  <SegmentedToggle
                    value={agentView}
                    onChange={(nextView) => {
                      setAgentView(nextView)
                      if (nextView === 'hierarchy') {
                        void fetchHierarchy()
                      }
                    }}
                    tone="neutral"
                    ariaLabel="Agent view"
                    items={[
                      { value: 'list', label: 'List' },
                      { value: 'hierarchy', label: 'Hierarchy' },
                    ]}
                  />

                  {agentView === 'list' && (
                    <SegmentedToggle
                      value={listViewMode}
                      onChange={setListViewMode}
                      tone="accent"
                      size="xs"
                      ariaLabel="List layout"
                      items={[
                        {
                          value: 'card',
                          label: <LayoutGrid className="w-4 h-4" />,
                          title: 'Card view',
                        },
                        {
                          value: 'list',
                          label: <List className="w-4 h-4" />,
                          title: 'Table view',
                        },
                      ]}
                    />
                  )}

                  <Button
                    onClick={() => setShowTemplateWizard(true)}
                    variant="secondary"
                    size="sm"
                  >
                    <LayoutTemplate className="w-3.5 h-3.5" />
                    From Template
                  </Button>
                  <Button
                    onClick={() => setShowCreateModal(true)}
                    variant="primary"
                    size="sm"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Create Agent
                  </Button>
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

        {activeTab === 'agents' && modelCatalogError && (
          <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-status-warning/40 bg-status-warning/10 p-3 text-status-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="text-sm">
              <p>Model availability could not be refreshed.</p>
              <p className="text-xs text-status-warning/90">Editing still works, but unavailable-model checks may be stale.</p>
            </div>
          </div>
        )}

        {activeTab === 'stations' ? (
          <StationsTab />
        ) : activeTab === 'teams' ? (
          <TeamsTab />
        ) : (
          <>
            {agentView === 'hierarchy' ? (
              <HierarchyView
                data={hierarchyData}
                loading={hierarchyLoading}
                error={hierarchyError}
                onRetry={() => void fetchHierarchy()}
              />
            ) : (
              <>
                {/* Content: Card View or Table View */}
                {listViewMode === 'card' ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {agents.length === 0 ? (
                      <div className="col-span-full">
                        <EmptyState
                          icon={<Bot className="w-8 h-8" />}
                          title="No agents configured"
                          description="Create your first agent to get started."
                        />
                      </div>
                    ) : (
                      agents.map((agent) => (
                        <AgentCard
                          key={agent.id}
                          agent={agent}
                          selected={selectedId === agent.id}
                          onProvision={() => handleProvisionAgent(agent)}
                          onTest={() => handleTestAgent(agent)}
                          onEditFile={(filePath, fileName) => handleFileEdit(filePath, fileName)}
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
                          title="No agents configured"
                          description="Create your first agent to get started."
                        />
                      }
                    />
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* File Editor Modal (contained within page content area) */}
        {editingFile && (
          <FileEditorModal
            isOpen={!!editingFile}
            onClose={() => setEditingFile(null)}
            filePath={editingFile.filePath}
            fileName={editingFile.fileName}
            onSaved={handleFileSaved}
          />
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

          {/* Detail Drawer */}
          {agentView === 'list' && (
            <RightDrawer
              open={!!selectedAgent}
              onClose={() => setSelectedId(undefined)}
              title={selectedAgent?.displayName}
              description={selectedAgent?.role}
              width="full"
            >
              {selectedAgent && (
                <AgentDetail
                  agent={selectedAgent}
                  assignedOps={assignedOps}
                  onProvision={() => handleProvisionAgent(selectedAgent)}
                  onTest={() => handleTestAgent(selectedAgent)}
                  onDelete={() => handleDeleteAgent(selectedAgent)}
                  onEdit={(patch) => handleEditAgent(selectedAgent, patch)}
                  onAvatarUpload={(file) => handleAvatarUpload(selectedAgent, file)}
                  onAvatarReset={() => handleAvatarReset(selectedAgent)}
                  onDuplicateSkills={(skillIds) => handleDuplicateSkills(selectedAgent, skillIds)}
                  onEditFile={(filePath, fileName) => handleFileEdit(filePath, fileName)}
                  modelCatalog={modelCatalog.entries}
                  modelStatusById={modelCatalog.statusById}
                  modelCatalogLoading={modelCatalogLoading}
                />
              )}
            </RightDrawer>
          )}
        </>
      )}
    </>
  )
}

// ============================================================================
// CREATE AGENT MODAL
// ============================================================================

interface CreateAgentFormData {
  displayName: string
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
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState('')
  const [purpose, setPurpose] = useState('')
  const [capabilities, setCapabilities] = useState<string[]>([])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!role || !purpose) return

    onSubmit({ displayName: displayName.trim(), role, purpose, capabilities })
  }

  const toggleCapability = (cap: string) => {
    setCapabilities((prev) =>
      prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]
    )
  }

  const selectedRole = ROLE_OPTIONS.find((r) => r.value === role)
  const previewName = displayName || (role ? buildAutoAgentName(role) : 'agent-...')
  const previewSlug = buildAgentSlugPreview(previewName, role)

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
                <p className="text-xs text-fg-2">Slug: {previewSlug}</p>
              </div>
            </div>
          </div>

          {/* Display Name */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-fg-1">Display Name (optional)</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={role ? buildAutoAgentName(role) : 'agent-worker'}
              className="w-full px-3 py-2 bg-bg-2 border border-bd-0 rounded-[var(--radius-md)] text-sm text-fg-0 placeholder:text-fg-3"
            />
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
            <Button
              type="button"
              onClick={onClose}
              variant="secondary"
              size="md"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!role || !purpose}
              variant="primary"
              size="md"
            >
              Create Agent
            </Button>
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
  onSubmit: (templateId: string, params: Record<string, unknown>, displayName?: string) => void
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
  const [displayName, setDisplayName] = useState('')

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
      setDisplayName('')
      setPreviewFiles([])
      setError(null)
    }
  }, [isOpen])

  function formatFetchError(err: unknown, fallback: string): string {
    if (!(err instanceof Error)) return fallback
    if (err.message === 'Failed to fetch') {
      return 'Failed to reach the server. Check the dev server logs for build/runtime errors and try again.'
    }
    return err.message
  }

  async function fetchTemplates() {
    setLoading(true)
    try {
      const result = await templatesApi.list()
      // Only show valid templates
      setTemplates(result.data.filter((t) => t.isValid))
    } catch (err) {
      setError(formatFetchError(err, 'Failed to load templates'))
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
      setError(formatFetchError(err, 'Failed to load template'))
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

    if (!selectedTemplateId) return

    setLoading(true)
    agentsApi.previewFromTemplate({ templateId: selectedTemplateId, params, displayName: displayName || undefined })
      .then((res) => {
        setPreviewFiles(res.data.files)
        setStep('preview')
      })
      .catch((err) => {
        setError(formatFetchError(err, 'Failed to render preview'))
      })
      .finally(() => {
        setLoading(false)
      })
  }

  function handleConfirm() {
    if (!selectedTemplateId) return
    onSubmit(selectedTemplateId, params, displayName || undefined)
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
            <LoadingState height="sm" />
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
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-fg-1">
                  Display Name (optional)
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={selectedTemplate?.name || 'agent-worker'}
                  className="w-full px-3 py-2 bg-bg-2 border border-bd-0 rounded-[var(--radius-md)] text-sm text-fg-0 placeholder:text-fg-3"
                />
                <p className="text-xs text-fg-2">
                  Slug preview: {buildAgentSlugPreview(displayName || selectedTemplate?.name || '', selectedTemplate?.role || '')}
                </p>
              </div>

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
                        <SelectDropdown
                          value={String(params[key] || '')}
                          onChange={(nextValue) => handleParamChange(key, nextValue)}
                          ariaLabel={`${key} parameter`}
                          tone="field"
                          size="md"
                          placeholder="Select..."
                          options={[
                            { value: '', label: 'Select...', disabled: true },
                            ...prop.enum.map((val) => ({
                              value: String(val),
                              label: String(val),
                            })),
                          ]}
                        />
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
              <Button
                onClick={() => setStep(step === 'preview' ? 'params' : 'select')}
                variant="ghost"
                size="md"
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-3">
            <Button
              onClick={onClose}
              variant="secondary"
              size="md"
            >
              Cancel
            </Button>
            {step === 'params' && (
              <Button
                onClick={handleProceedToPreview}
                variant="primary"
                size="md"
              >
                Preview
                <Eye className="w-4 h-4" />
              </Button>
            )}
            {step === 'preview' && (
              <Button
                onClick={handleConfirm}
                variant="primary"
                size="md"
              >
                Create Agent
                <Check className="w-4 h-4" />
              </Button>
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
  onDelete,
  onEdit,
  onAvatarUpload,
  onAvatarReset,
  onDuplicateSkills,
  onEditFile,
  modelCatalog,
  modelStatusById,
  modelCatalogLoading,
}: {
  agent: AgentDTO
  assignedOps: OperationDTO[]
  onProvision: () => void
  onTest: () => void
  onDelete: () => void
  onEdit: (patch: {
    displayName?: string
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
  onEditFile: (filePath: string, fileName?: string) => void
  modelCatalog: AgentModelCatalogEntry[]
  modelStatusById: Record<string, AgentKnownModelStatus>
  modelCatalogLoading: boolean
}) {
  const toneMap: Record<string, StatusTone> = {
    active: 'success',
    idle: 'muted',
    blocked: 'warning',
    error: 'danger',
  }

  const { stations, stationsById } = useStations()
  const normalizeCaps = (caps: Record<string, unknown>): Record<string, boolean> =>
    Object.fromEntries(
      Object.entries(caps).map(([key, value]) => [key, Boolean(value)])
    )

  const [editDisplayName, setEditDisplayName] = useState(agent.displayName)
  const [editRole, setEditRole] = useState(agent.role)
  const [editStation, setEditStation] = useState(agent.station)
  const [editWipLimit, setEditWipLimit] = useState<number>(agent.wipLimit)
  const [editSessionKey, setEditSessionKey] = useState(agent.sessionKey)
  const [editCaps, setEditCaps] = useState<Record<string, boolean>>(normalizeCaps(agent.capabilities))
  const [editModel, setEditModel] = useState(agent.model || DEFAULT_MODEL)
  const [editFallbacks, setEditFallbacks] = useState<string[]>(agent.fallbacks ?? [])
  const [detailTab, setDetailTab] = useState<'overview' | 'configuration' | 'assets'>('overview')
  const [showCreateStation, setShowCreateStation] = useState(false)

  // Skills state
  const [agentSkills, setAgentSkills] = useState<SkillSummary[]>([])
  const [loadingSkills, setLoadingSkills] = useState(false)
  const [showSkillSelector, setShowSkillSelector] = useState(false)

  // File input ref
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setEditDisplayName(agent.displayName)
    setEditRole(agent.role)
    setEditStation(agent.station)
    setEditWipLimit(agent.wipLimit)
    setEditSessionKey(agent.sessionKey)
    setEditCaps(normalizeCaps(agent.capabilities))
    setEditModel(agent.model || DEFAULT_MODEL)
    setEditFallbacks((agent.fallbacks ?? []).filter((m) => m !== (agent.model || DEFAULT_MODEL)))
    setDetailTab('overview')
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
  const agentSlug = agent.slug || slugifyDisplayName(agent.displayName)
  const agentFiles: Array<{ label: string; path: string }> = [
    { label: 'SOUL.md', path: `/agents/${agentSlug}/SOUL.md` },
    { label: 'HEARTBEAT.md', path: `/agents/${agentSlug}/HEARTBEAT.md` },
    { label: `${agentSlug}.md`, path: `/agents/${agentSlug}.md` },
  ]
  const agentStationLabel = stationsById[agent.station]?.name ?? agent.station
  const isMainAgent = (agent.slug ?? '').trim().toLowerCase() === 'main'
    || (agent.runtimeAgentId ?? '').trim().toLowerCase() === 'main'
    || agent.displayName.trim().toLowerCase() === 'main'
  const sortedStations = [...stations].sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name))
  const modelEntries = modelCatalog.length > 0 ? modelCatalog : DEFAULT_AGENT_MODEL_CATALOG.entries

  const isKnownUnavailableModel = (modelId: string): boolean => {
    const status = modelStatusById[modelId]
    if (!status) return false
    return status.missing || !status.available
  }

  const primaryModelUnavailable = isKnownUnavailableModel(editModel)
  const unavailableFallbackIds = editFallbacks.filter((modelId) => isKnownUnavailableModel(modelId))
  const suggestedPrimaryModel = modelEntries.find(
    (model) => model.id !== editModel && !isKnownUnavailableModel(model.id)
  )?.id
  const canSaveConfiguration = !primaryModelUnavailable && unavailableFallbackIds.length === 0

  const modelOptions = modelEntries.map((model) => ({
    value: model.id,
    label: model.name,
    description: isKnownUnavailableModel(model.id) ? 'Unavailable for this provider' : model.description,
    icon: <ProviderLogo provider={model.provider} size="sm" className="h-4 w-4 rounded-sm" />,
    textValue: `${model.id} ${model.name} ${model.description} ${model.provider}`,
    disabled: isKnownUnavailableModel(model.id) && model.id !== editModel,
  }))
  const availableFallbackModels = modelEntries
    .filter((model) => model.id !== editModel)
    .filter((model) => !editFallbacks.includes(model.id))
    .filter((model) => !isKnownUnavailableModel(model.id))
  const fallbackModelOptions = availableFallbackModels.map((model) => ({
    value: model.id,
    label: model.name,
    description: model.description,
    icon: <ProviderLogo provider={model.provider} size="sm" className="h-4 w-4 rounded-sm" />,
    textValue: `${model.id} ${model.name} ${model.description} ${model.provider}`,
  }))
  const stationOptions = sortedStations.map((station) => ({
    value: station.id,
    label: station.name,
    description: station.id,
    icon: <StationIcon stationId={station.id} />,
    textValue: `${station.id} ${station.name}`,
  }))
  const lastHeartbeatDisplayAt = agent.lastHeartbeatAt ?? agent.lastSeenAt

  return (
    <div className="space-y-5">
      <SegmentedToggle
        value={detailTab}
        onChange={(next) => setDetailTab(next as 'overview' | 'configuration' | 'assets')}
        tone="neutral"
        ariaLabel="Agent detail section"
        items={[
          { value: 'overview', label: 'Overview' },
          { value: 'configuration', label: 'Configuration' },
          { value: 'assets', label: 'Files & Skills' },
        ]}
      />

      {detailTab === 'overview' && (
        <>
          <div className="flex flex-wrap items-center gap-4">
            <AgentAvatar agentId={agent.id} name={agent.displayName} size="xl" />
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

          <div className="flex flex-wrap items-center gap-3">
            <StatusPill tone={toneMap[agent.status]} label={agent.status} />
            <span className="px-2 py-0.5 text-xs bg-bg-3 rounded text-fg-1 inline-flex items-center gap-1.5">
              <StationIcon stationId={agent.station} />
              {agentStationLabel}
            </span>
            <ModelBadge modelId={agent.model} size="sm" showIcon />
          </div>

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
              <button
                onClick={onDelete}
                disabled={isMainAgent}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] border transition-colors',
                  isMainAgent
                    ? 'bg-bg-3 text-fg-3 border-bd-0 cursor-not-allowed'
                    : 'bg-status-danger/10 text-status-danger border-status-danger/30 hover:bg-status-danger/20'
                )}
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            </div>
          </PageSection>

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

          <PageSection title="Details">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-fg-2">Display Name</dt>
              <dd className="text-fg-1">{agent.displayName}</dd>
              <dt className="text-fg-2">Slug (immutable)</dt>
              <dd className="text-fg-1 font-mono text-xs truncate">{agent.slug}</dd>
              <dt className="text-fg-2">Runtime ID (immutable)</dt>
              <dd className="text-fg-1 font-mono text-xs truncate">{agent.runtimeAgentId}</dd>
              <dt className="text-fg-2">Name Source</dt>
              <dd className="text-fg-1 text-xs uppercase">{agent.nameSource}</dd>
              <dt className="text-fg-2">WIP Limit</dt>
              <dd className="text-fg-1 font-mono">{agent.wipLimit}</dd>
              <dt className="text-fg-2">Session Key</dt>
              <dd className="text-fg-1 font-mono text-xs truncate">{agent.sessionKey}</dd>
              <dt className="text-fg-2">Last Heartbeat</dt>
              <dd className="text-fg-1 font-mono text-xs">
                {lastHeartbeatDisplayAt
                  ? formatRelativeTime(lastHeartbeatDisplayAt)
                  : 'Never'}
              </dd>
              <dt className="text-fg-2">Registered</dt>
              <dd className="text-fg-1 font-mono text-xs">{new Date(agent.createdAt).toLocaleDateString()}</dd>
            </dl>
          </PageSection>
        </>
      )}

      {detailTab === 'assets' && (
        <>
          <PageSection title="Agent Files">
            <div className="flex flex-wrap gap-2">
              {agentFiles.map((fileName) => (
                <button
                  key={fileName.path}
                  onClick={() => onEditFile(fileName.path, fileName.label)}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-[var(--radius-md)] bg-bg-3 text-fg-1 hover:bg-bg-3/80 border border-bd-0 transition-colors"
                >
                  <FileText className="w-3.5 h-3.5 text-fg-2" />
                  {fileName.label}
                </button>
              ))}
            </div>
          </PageSection>

          <PageSection title="Skills" description={`${agentSkills.length} agent-scoped skills`}>
            <div className="space-y-2">
              {loadingSkills ? (
                <div className="flex items-center justify-center py-4">
                  <LoadingSpinner size="md" className="text-fg-2" />
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
        </>
      )}

      {detailTab === 'configuration' && (
        <>
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

          <PageSection title="Edit Configuration" description="Requires typed confirmation">
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs text-fg-2">Display Name</label>
                <input
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  className="w-full px-2 py-1.5 bg-bg-2 border border-bd-0 rounded-[var(--radius-md)] text-sm text-fg-0"
                />
                <p className="text-[11px] text-fg-3">Rename is safe. Slug/runtime identity remain unchanged.</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-fg-2">AI Model</label>
                <SelectDropdown
                  value={editModel}
                  onChange={(nextValue) => {
                    setEditModel(nextValue)
                    setEditFallbacks((prev) => prev.filter((modelId) => modelId !== nextValue))
                  }}
                  ariaLabel="AI model"
                  tone="field"
                  size="sm"
                  options={modelOptions}
                  search="auto"
                />
                {modelCatalogLoading && (
                  <p className="text-[11px] text-fg-3">Refreshing model availability…</p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-xs text-fg-2">Fallbacks</label>

                <div className="flex flex-wrap gap-2">
                  {editFallbacks.length === 0 ? (
                    <span className="text-xs text-fg-3">None</span>
                  ) : (
                    editFallbacks.map((fb, idx) => {
                      const isUnavailable = isKnownUnavailableModel(fb)
                      return (
                        <span
                          key={`${fb}-${idx}`}
                          className={cn(
                            'inline-flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius-md)] border',
                            isUnavailable
                              ? 'bg-status-danger/10 border-status-danger/40'
                              : 'bg-bg-3 border-bd-0'
                          )}
                        >
                          <ModelBadge modelId={fb} size="sm" />
                          {isUnavailable && (
                            <span className="text-[10px] uppercase tracking-wide text-status-danger">Unavailable</span>
                          )}

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
                      )
                    })
                  )}
                </div>

                <SelectDropdown
                  value={null}
                  onChange={(nextValue) => setEditFallbacks((prev) => [...prev, nextValue])}
                  ariaLabel="Add fallback model"
                  tone="field"
                  size="sm"
                  placeholder="Add fallback..."
                  options={fallbackModelOptions}
                  disabled={fallbackModelOptions.length === 0}
                  search="auto"
                  emptyMessage="No more models available"
                />

                <p className="text-[11px] text-fg-3">Tried in order if primary fails. Stored as a JSON array of model IDs.</p>
              </div>

              {(primaryModelUnavailable || unavailableFallbackIds.length > 0) && (
                <div className="rounded-[var(--radius-md)] border border-status-warning/40 bg-status-warning/10 p-3">
                  <p className="text-xs text-status-warning">
                    One or more selected models are unavailable for the configured provider.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {suggestedPrimaryModel && primaryModelUnavailable && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditModel(suggestedPrimaryModel)
                          setEditFallbacks((prev) => prev.filter((modelId) => modelId !== suggestedPrimaryModel))
                        }}
                        className="px-2 py-1 text-xs rounded-[var(--radius-sm)] border border-status-warning/40 text-status-warning hover:bg-status-warning/15"
                      >
                        Use suggested primary
                      </button>
                    )}
                    {unavailableFallbackIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setEditFallbacks((prev) => prev.filter((modelId) => !isKnownUnavailableModel(modelId)))}
                        className="px-2 py-1 text-xs rounded-[var(--radius-sm)] border border-status-warning/40 text-status-warning hover:bg-status-warning/15"
                      >
                        Remove unavailable fallbacks
                      </button>
                    )}
                  </div>
                </div>
              )}

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
                  <SelectDropdown
                    value={editStation}
                    onChange={setEditStation}
                    ariaLabel="Agent station"
                    tone="field"
                    size="sm"
                    options={stationOptions}
                    search="auto"
                    footerAction={{
                      label: '+ Create new...',
                      onClick: () => setShowCreateStation(true),
                    }}
                  />
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

              {!canSaveConfiguration && (
                <p className="text-xs text-status-warning">
                  Fix unavailable primary/fallback models before saving this agent.
                </p>
              )}

              <div className="pt-2">
                <button
                  disabled={!canSaveConfiguration}
                  onClick={() => onEdit({
                    displayName: editDisplayName.trim(),
                    role: editRole,
                    station: editStation,
                    wipLimit: editWipLimit,
                    sessionKey: editSessionKey,
                    capabilities: editCaps,
                    model: editModel,
                    fallbacks: editFallbacks,
                  })}
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] border transition-colors',
                    canSaveConfiguration
                      ? 'bg-status-warning/10 text-status-warning border-status-warning/30 hover:bg-status-warning/20'
                      : 'bg-bg-3 text-fg-3 border-bd-0 cursor-not-allowed'
                  )}
                >
                  Save Changes
                </button>
              </div>
            </div>
          </PageSection>
        </>
      )}

      <SkillSelector
        isOpen={showSkillSelector}
        onClose={() => setShowSkillSelector(false)}
        agentId={agent.id}
        agentName={agent.displayName}
        onSelectSkills={(skillIds) => {
          setShowSkillSelector(false)
          onDuplicateSkills(skillIds)
        }}
      />

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
