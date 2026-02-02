'use client'

import { useState, useEffect } from 'react'
import { PageHeader, PageSection, EmptyState } from '@savorg/ui'
import { CanonicalTable, type Column } from '@/components/ui/canonical-table'
import { StatusPill } from '@/components/ui/status-pill'
import { RightDrawer } from '@/components/shell/right-drawer'
import { useProtectedActionTrigger } from '@/components/protected-action-modal'
import { agentsApi, operationsApi, templatesApi, type TemplateSummary } from '@/lib/http'
import type { AgentDTO, OperationDTO } from '@/lib/repo'
import { cn } from '@/lib/utils'
import { Bot, Plus, Loader2, X, Check, Zap, MessageSquare, LayoutTemplate, ChevronRight, ChevronLeft, FileCode, Eye } from 'lucide-react'
import type { StatusTone } from '@savorg/ui/theme'

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
    width: '140px',
    mono: true,
    render: (row) => (
      <div className="flex items-center gap-2">
        <span className={cn(
          'w-2 h-2 rounded-full',
          row.status === 'active' && 'bg-status-success',
          row.status === 'idle' && 'bg-fg-3',
          row.status === 'blocked' && 'bg-status-warning',
          row.status === 'error' && 'bg-status-danger'
        )} />
        <span className="text-status-progress">{row.name}</span>
      </div>
    ),
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
      <span className="px-2 py-0.5 text-xs bg-bg-3 rounded text-fg-1">{row.station}</span>
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

  // Create agent modal state
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createResult, setCreateResult] = useState<{ success: boolean; message: string } | null>(null)

  // Create from template wizard state
  const [showTemplateWizard, setShowTemplateWizard] = useState(false)

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
  const activeCount = agents.filter((a) => a.status === 'active').length

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
      const result = await agentsApi.test(agent.id, 'Hello from Mission Control!')
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

  // Handle create agent
  const handleCreateAgent = (formData: CreateAgentFormData) => {
    triggerProtectedAction({
      actionKind: 'agent.create',
      actionTitle: 'Create Agent',
      actionDescription: `Create new agent "${formData.role}" with name savorg${formData.role.toUpperCase()}`,
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
          subtitle={`${agents.length} agents configured`}
          actions={
            <div className="flex gap-2">
              <button
                onClick={() => setShowTemplateWizard(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] border border-white/[0.06] text-fg-1 hover:bg-bg-3 transition-colors"
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
            </div>
          }
        />

        {/* Result banner */}
        {createResult && (
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

        <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-white/[0.06] overflow-hidden">
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
                title="No agents registered"
                description="Create an agent to get started"
              />
            }
          />
        </div>
      </div>

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
          />
        )}
      </RightDrawer>
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
  const previewName = role ? `savorg${role.toUpperCase()}` : 'savorg...'

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-bg-1 rounded-[var(--radius-lg)] border border-white/[0.06] shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
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
          <div className="p-4 bg-bg-3 rounded-[var(--radius-md)] border border-white/[0.06]">
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
                      : 'border-white/[0.06] hover:border-bd-1'
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
              className="w-full px-3 py-2 bg-bg-2 border border-white/[0.06] rounded-[var(--radius-md)] text-sm text-fg-0 placeholder:text-fg-3 focus:outline-none focus:border-status-progress resize-none"
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
                      : 'border-white/[0.06] text-fg-2 hover:border-bd-1'
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
          <div className="flex justify-end gap-3 pt-4 border-t border-white/[0.06]">
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
      <div className="relative w-full max-w-2xl bg-bg-1 rounded-[var(--radius-lg)] border border-white/[0.06] shadow-xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] shrink-0">
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
        <div className="flex items-center gap-2 px-6 py-3 border-b border-white/[0.06] shrink-0">
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
                        : 'border-white/[0.06] hover:border-bd-1'
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
                          className="w-full px-3 py-2 bg-bg-2 border border-white/[0.06] rounded-[var(--radius-md)] text-sm text-fg-0"
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
                          className="w-full px-3 py-2 bg-bg-2 border border-white/[0.06] rounded-[var(--radius-md)] text-sm text-fg-0 placeholder:text-fg-3"
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
                  className="p-4 bg-bg-2 rounded-[var(--radius-md)] border border-white/[0.06]"
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
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/[0.06] shrink-0">
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
  }) => void
}) {
  const toneMap: Record<string, StatusTone> = {
    active: 'success',
    idle: 'muted',
    blocked: 'warning',
    error: 'danger',
  }

  const [editRole, setEditRole] = useState(agent.role)
  const [editStation, setEditStation] = useState(agent.station)
  const [editWipLimit, setEditWipLimit] = useState<number>(agent.wipLimit)
  const [editSessionKey, setEditSessionKey] = useState(agent.sessionKey)
  const [editCaps, setEditCaps] = useState<Record<string, boolean>>(agent.capabilities)

  useEffect(() => {
    setEditRole(agent.role)
    setEditStation(agent.station)
    setEditWipLimit(agent.wipLimit)
    setEditSessionKey(agent.sessionKey)
    setEditCaps(agent.capabilities)
  }, [agent.id])

  return (
    <div className="space-y-6">
      {/* Status */}
      <div className="flex items-center gap-3">
        <StatusPill tone={toneMap[agent.status]} label={agent.status} />
        <span className="px-2 py-0.5 text-xs bg-bg-3 rounded text-fg-1">{agent.station}</span>
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

      {/* Current Work */}
      <PageSection
        title="Current Work"
        description={`${assignedOps.filter((op) => op.status === 'in_progress').length} in progress`}
      >
        <div className="space-y-2">
          {assignedOps.map((op) => (
            <div
              key={op.id}
              className="flex items-center justify-between p-3 bg-bg-3 rounded-[var(--radius-md)] border border-white/[0.06]"
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
                className="px-2 py-1 text-xs bg-bg-3 rounded text-fg-1 border border-white/[0.06]"
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
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs text-fg-2">Role</label>
              <input
                value={editRole}
                onChange={(e) => setEditRole(e.target.value)}
                className="w-full px-2 py-1.5 bg-bg-2 border border-white/[0.06] rounded-[var(--radius-md)] text-sm text-fg-0"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-fg-2">Station</label>
              <select
                value={editStation}
                onChange={(e) => setEditStation(e.target.value)}
                className="w-full px-2 py-1.5 bg-bg-2 border border-white/[0.06] rounded-[var(--radius-md)] text-sm text-fg-0"
              >
                {['spec','build','qa','ops','update','ship','compound'].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs text-fg-2">WIP Limit</label>
              <input
                type="number"
                value={editWipLimit}
                onChange={(e) => setEditWipLimit(parseInt(e.target.value || '0', 10))}
                className="w-full px-2 py-1.5 bg-bg-2 border border-white/[0.06] rounded-[var(--radius-md)] text-sm text-fg-0"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-fg-2">Session Key</label>
              <input
                value={editSessionKey}
                onChange={(e) => setEditSessionKey(e.target.value)}
                className="w-full px-2 py-1.5 bg-bg-2 border border-white/[0.06] rounded-[var(--radius-md)] text-sm text-fg-0 font-mono"
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
                      : 'bg-bg-3 text-fg-2 border-white/[0.06] hover:border-bd-1'
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
              })}
              className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-status-warning/10 text-status-warning border border-status-warning/30 hover:bg-status-warning/20 transition-colors"
            >
              Save Changes
            </button>
          </div>
        </div>
      </PageSection>
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
