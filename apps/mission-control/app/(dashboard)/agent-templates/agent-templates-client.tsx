'use client'

import { useState, useCallback } from 'react'
import { PageHeader, EmptyState, TypedConfirmModal } from '@savorgos/ui'
import { CanonicalTable, type Column } from '@/components/ui/canonical-table'
import { StatusPill } from '@/components/ui/status-pill'
import { RightDrawer } from '@/components/shell/right-drawer'
import { useProtectedAction } from '@/lib/hooks/useProtectedAction'
import { templatesApi, type TemplateWithFiles, type TemplateFile } from '@/lib/http'
import type { AgentTemplate } from '@savorgos/core'
import { cn } from '@/lib/utils'
import {
  LayoutTemplate,
  Plus,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Info,
  FileText,
  FolderOpen,
  AlertCircle,
  Trash2,
  X,
  FileCode,
  Eye,
  Download,
  Upload,
} from 'lucide-react'

// ============================================================================
// TYPES
// ============================================================================

interface Props {
  templates: AgentTemplate[]
}

type TabId = 'overview' | 'readme' | 'files' | 'validation'

const tabs: { id: TabId; label: string; icon: typeof Info }[] = [
  { id: 'overview', label: 'Overview', icon: Info },
  { id: 'readme', label: 'README', icon: FileText },
  { id: 'files', label: 'Files', icon: FolderOpen },
  { id: 'validation', label: 'Validation', icon: AlertCircle },
]

const AGENT_ROLES = [
  'CEO',
  'BUILD',
  'OPS',
  'REVIEW',
  'SPEC',
  'QA',
  'SHIP',
  'COMPOUND',
  'UPDATE',
  'CUSTOM',
] as const

// ============================================================================
// COMPONENTS
// ============================================================================

function TemplateStatusPill({ isValid, warningCount }: { isValid: boolean; warningCount: number }) {
  if (!isValid) {
    return <StatusPill tone="danger" label="Invalid" />
  }
  if (warningCount > 0) {
    return <StatusPill tone="warning" label="Warnings" />
  }
  return <StatusPill tone="success" label="Valid" />
}

const templateColumns: Column<AgentTemplate>[] = [
  {
    key: 'name',
    header: 'Template',
    width: '200px',
    mono: true,
    render: (row) => (
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'w-2 h-2 rounded-full',
            row.isValid ? 'bg-status-success' : 'bg-status-error'
          )}
        />
        <span className="text-fg-0">{row.name}</span>
      </div>
    ),
  },
  {
    key: 'description',
    header: 'Description',
    render: (row) => (
      <span className="text-fg-1 truncate max-w-[220px] inline-block">{row.description}</span>
    ),
  },
  {
    key: 'role',
    header: 'Role',
    width: '100px',
    mono: true,
    render: (row) => <span className="text-fg-2">{row.role}</span>,
  },
  {
    key: 'version',
    header: 'Version',
    width: '80px',
    mono: true,
    render: (row) => <span className="text-fg-2">{row.version}</span>,
  },
  {
    key: 'isValid',
    header: 'Status',
    width: '100px',
    render: (row) => (
      <TemplateStatusPill isValid={row.isValid} warningCount={row.validationWarnings.length} />
    ),
  },
]

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function AgentTemplatesClient({ templates: initialTemplates }: Props) {
  const [templates, setTemplates] = useState(initialTemplates)
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateWithFiles | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [error, setError] = useState<string | null>(null)

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createId, setCreateId] = useState('')
  const [createName, setCreateName] = useState('')
  const [createRole, setCreateRole] = useState<string>('BUILD')
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // File preview state
  const [previewFile, setPreviewFile] = useState<{ name: string; content: string } | null>(null)
  const [isLoadingFile, setIsLoadingFile] = useState(false)

  // Import modal state
  const [showImportModal, setShowImportModal] = useState(false)
  const [importData, setImportData] = useState<string>('')
  const [isImporting, setIsImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  // Export state
  const [isExporting, setIsExporting] = useState(false)

  const protectedAction = useProtectedAction()

  const validCount = templates.filter((t) => t.isValid).length
  const invalidCount = templates.filter((t) => !t.isValid).length

  // Load full template details when selecting
  const handleSelectTemplate = useCallback(async (template: AgentTemplate) => {
    setIsLoading(true)
    setError(null)
    setPreviewFile(null)
    try {
      const result = await templatesApi.get(template.id)
      setSelectedTemplate(result.data)
      setActiveTab('overview')
    } catch (err) {
      console.error('Failed to load template:', err)
      setError('Failed to load template details')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Create template
  const handleCreate = useCallback(() => {
    if (!createId.trim() || !createName.trim()) {
      setCreateError('ID and name are required')
      return
    }

    // Validate ID format
    const idPattern = /^[a-z0-9][a-z0-9-_]{1,48}[a-z0-9]$/
    if (!idPattern.test(createId)) {
      setCreateError('ID must be lowercase alphanumeric with dashes/underscores, 3-50 chars')
      return
    }

    setCreateError(null)

    protectedAction.trigger({
      actionKind: 'template.create',
      actionTitle: 'Create Template',
      actionDescription: `Create a new agent template "${createName}" for ${createRole} agents`,
      onConfirm: async (typedConfirmText) => {
        setIsCreating(true)
        try {
          const result = await templatesApi.create({
            id: createId,
            name: createName,
            role: createRole,
            typedConfirmText,
          })

          // Refresh templates list
          const refreshed = await templatesApi.list({ rescan: true })
          setTemplates(refreshed.data as unknown as AgentTemplate[])

          // Close modal and reset
          setShowCreateModal(false)
          setCreateId('')
          setCreateName('')
          setCreateRole('BUILD')

          // Select the new template
          handleSelectTemplate(result.data as unknown as AgentTemplate)
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to create template'
          setCreateError(message)
        } finally {
          setIsCreating(false)
        }
      },
      onError: (err) => {
        console.error('Failed to create template:', err)
        setCreateError(err.message)
        setIsCreating(false)
      },
    })
  }, [createId, createName, createRole, protectedAction, handleSelectTemplate])

  // Delete template
  const handleDelete = useCallback(() => {
    if (!selectedTemplate) return

    setError(null)

    protectedAction.trigger({
      actionKind: 'template.delete',
      actionTitle: 'Delete Template',
      actionDescription: `Permanently delete the "${selectedTemplate.name}" template`,
      entityName: selectedTemplate.name,
      onConfirm: async (typedConfirmText) => {
        setIsDeleting(true)
        try {
          await templatesApi.delete(selectedTemplate.id, typedConfirmText)

          // Refresh templates list
          const refreshed = await templatesApi.list({ rescan: true })
          setTemplates(refreshed.data as unknown as AgentTemplate[])

          // Close drawer
          setSelectedTemplate(null)
        } finally {
          setIsDeleting(false)
        }
      },
      onError: (err) => {
        console.error('Failed to delete template:', err)
        setError('Failed to delete template')
        setIsDeleting(false)
      },
    })
  }, [selectedTemplate, protectedAction])

  // Load file content
  const handlePreviewFile = useCallback(async (file: TemplateFile) => {
    if (!selectedTemplate) return

    setIsLoadingFile(true)
    try {
      const result = await templatesApi.getFile(selectedTemplate.id, file.id)
      setPreviewFile({ name: file.name, content: result.data.content })
    } catch (err) {
      console.error('Failed to load file:', err)
      setError('Failed to load file content')
    } finally {
      setIsLoadingFile(false)
    }
  }, [selectedTemplate])

  // Export template
  const handleExport = useCallback(async () => {
    if (!selectedTemplate) return

    setIsExporting(true)
    setError(null)

    try {
      const blob = await templatesApi.export(selectedTemplate.id)
      // Download the blob as a file
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${selectedTemplate.id}.template.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Failed to export template:', err)
      setError('Failed to export template')
    } finally {
      setIsExporting(false)
    }
  }, [selectedTemplate])

  // Import template
  const handleImport = useCallback(() => {
    if (!importData.trim()) {
      setImportError('Please paste template JSON data')
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(importData)
    } catch {
      setImportError('Invalid JSON format')
      return
    }

    // Validate structure
    const data = parsed as Record<string, unknown>
    if (!data.templateId || !data.files) {
      setImportError('Invalid template format: missing templateId or files')
      return
    }

    setImportError(null)

    protectedAction.trigger({
      actionKind: 'template.import',
      actionTitle: 'Import Template',
      actionDescription: `Import template "${data.name || data.templateId}"`,
      onConfirm: async (typedConfirmText) => {
        setIsImporting(true)
        try {
          await templatesApi.import({
            template: data as {
              templateId: string
              name: string
              version: string
              exportedAt: string
              files: Record<string, string>
            },
            typedConfirmText,
          })

          // Refresh templates list
          const refreshed = await templatesApi.list({ rescan: true })
          setTemplates(refreshed.data as unknown as AgentTemplate[])

          // Close modal and reset
          setShowImportModal(false)
          setImportData('')
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to import template'
          setImportError(message)
        } finally {
          setIsImporting(false)
        }
      },
      onError: (err) => {
        console.error('Failed to import template:', err)
        setImportError(err.message)
        setIsImporting(false)
      },
    })
  }, [importData, protectedAction])

  return (
    <>
      <div className="w-full space-y-4">
        <PageHeader
          title="Agent Templates"
          subtitle={
            invalidCount > 0
              ? `${validCount} valid / ${invalidCount} invalid / ${templates.length} total`
              : `${validCount} templates available`
          }
          actions={
            <div className="flex gap-2">
              <button
                className="btn-secondary flex items-center gap-1.5"
                onClick={() => setShowImportModal(true)}
              >
                <Upload className="w-3.5 h-3.5" />
                Import
              </button>
              <button
                className="btn-primary flex items-center gap-1.5"
                onClick={() => setShowCreateModal(true)}
              >
                <Plus className="w-3.5 h-3.5" />
                New Template
              </button>
            </div>
          }
        />

        <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0 overflow-hidden">
          <CanonicalTable
            columns={templateColumns}
            rows={templates}
            rowKey={(row) => row.id}
            onRowClick={handleSelectTemplate}
            selectedKey={selectedTemplate?.id}
            density="compact"
            emptyState={
              <EmptyState
                icon={<LayoutTemplate className="w-8 h-8" />}
                title="No templates found"
                description="Create a template to standardize agent configurations"
              />
            }
          />
        </div>
      </div>

      {/* Detail Drawer */}
      <RightDrawer
        open={!!selectedTemplate}
        onClose={() => {
          setSelectedTemplate(null)
          setPreviewFile(null)
        }}
        title={selectedTemplate?.name}
        description={selectedTemplate?.description}
      >
        {selectedTemplate && (
          <TemplateDetail
            template={selectedTemplate}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            isLoading={isLoading}
            isDeleting={isDeleting}
            isExporting={isExporting}
            error={error}
            onDelete={handleDelete}
            onExport={handleExport}
            previewFile={previewFile}
            isLoadingFile={isLoadingFile}
            onPreviewFile={handlePreviewFile}
            onClosePreview={() => setPreviewFile(null)}
          />
        )}
      </RightDrawer>

      {/* Create Template Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowCreateModal(false)}
          />
          <div className="relative bg-bg-1 border border-bd-0 rounded-lg shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-fg-0">New Template</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-fg-2 hover:text-fg-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {createError && (
              <div className="mb-4 p-3 bg-status-error/10 border border-status-error/30 rounded-md text-sm text-status-error">
                {createError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-fg-1 mb-2">
                  Template ID
                </label>
                <input
                  type="text"
                  value={createId}
                  onChange={(e) => setCreateId(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''))}
                  placeholder="savorg-custom-agent"
                  className="w-full px-3 py-2 bg-bg-2 border border-bd-0 rounded-md font-mono text-sm text-fg-0 placeholder:text-fg-3 focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                />
                <p className="mt-1 text-xs text-fg-2">
                  Lowercase letters, numbers, dashes, and underscores only
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-fg-1 mb-2">
                  Display Name
                </label>
                <input
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="My Custom Agent Template"
                  className="w-full px-3 py-2 bg-bg-2 border border-bd-0 rounded-md text-sm text-fg-0 placeholder:text-fg-3 focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-fg-1 mb-2">
                  Agent Role
                </label>
                <div className="flex flex-wrap gap-2">
                  {AGENT_ROLES.map((role) => (
                    <button
                      key={role}
                      onClick={() => setCreateRole(role)}
                      className={cn(
                        'px-3 py-1.5 text-xs font-mono rounded-md border transition-colors',
                        createRole === role
                          ? 'bg-accent-primary/10 border-accent-primary text-accent-primary'
                          : 'border-bd-0 text-fg-2 hover:text-fg-1 hover:border-bd-1'
                      )}
                    >
                      {role}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowCreateModal(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={isCreating || !createId.trim() || !createName.trim()}
                className="btn-primary flex items-center gap-1.5"
              >
                {isCreating ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Plus className="w-3.5 h-3.5" />
                )}
                Create Template
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Template Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowImportModal(false)}
          />
          <div className="relative bg-bg-1 border border-bd-0 rounded-lg shadow-xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-fg-0">Import Template</h2>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-fg-2 hover:text-fg-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {importError && (
              <div className="mb-4 p-3 bg-status-error/10 border border-status-error/30 rounded-md text-sm text-status-error">
                {importError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-fg-1 mb-2">
                  Template JSON
                </label>
                <p className="text-xs text-fg-2 mb-2">
                  Paste the exported template JSON data below
                </p>
                <textarea
                  value={importData}
                  onChange={(e) => setImportData(e.target.value)}
                  placeholder='{"templateId": "...", "files": {...}}'
                  rows={10}
                  className="w-full px-3 py-2 bg-bg-2 border border-bd-0 rounded-md font-mono text-xs text-fg-0 placeholder:text-fg-3 focus:outline-none focus:ring-2 focus:ring-accent-primary/50 resize-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowImportModal(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={isImporting || !importData.trim()}
                className="btn-primary flex items-center gap-1.5"
              >
                {isImporting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Upload className="w-3.5 h-3.5" />
                )}
                Import Template
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

// ============================================================================
// TEMPLATE DETAIL COMPONENT
// ============================================================================

interface TemplateDetailProps {
  template: TemplateWithFiles
  activeTab: TabId
  onTabChange: (tab: TabId) => void
  isLoading: boolean
  isDeleting: boolean
  isExporting: boolean
  error: string | null
  onDelete: () => void
  onExport: () => void
  previewFile: { name: string; content: string } | null
  isLoadingFile: boolean
  onPreviewFile: (file: TemplateFile) => void
  onClosePreview: () => void
}

function TemplateDetail({
  template,
  activeTab,
  onTabChange,
  isLoading,
  isDeleting,
  isExporting,
  error,
  onDelete,
  onExport,
  previewFile,
  isLoadingFile,
  onPreviewFile,
  onClosePreview,
}: TemplateDetailProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="w-6 h-6 animate-spin text-fg-2" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="flex gap-1 border-b border-bd-0 px-4">
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
            {tab.id === 'validation' && !template.isValid && (
              <span className="ml-1 w-2 h-2 rounded-full bg-status-error" />
            )}
          </button>
        ))}
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mx-4 mt-4 p-3 bg-status-error/10 border border-status-error/30 rounded-md text-sm text-status-error">
          {error}
        </div>
      )}

      {/* Tab Content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'overview' && (
          <OverviewTab
            template={template}
            isDeleting={isDeleting}
            isExporting={isExporting}
            onDelete={onDelete}
            onExport={onExport}
          />
        )}
        {activeTab === 'readme' && <ReadmeTab template={template} />}
        {activeTab === 'files' && (
          <FilesTab
            template={template}
            previewFile={previewFile}
            isLoadingFile={isLoadingFile}
            onPreviewFile={onPreviewFile}
            onClosePreview={onClosePreview}
          />
        )}
        {activeTab === 'validation' && <ValidationTab template={template} />}
      </div>
    </div>
  )
}

// ============================================================================
// TAB COMPONENTS
// ============================================================================

function OverviewTab({
  template,
  isDeleting,
  isExporting,
  onDelete,
  onExport,
}: {
  template: TemplateWithFiles
  isDeleting: boolean
  isExporting: boolean
  onDelete: () => void
  onExport: () => void
}) {
  return (
    <div className="space-y-6">
      {/* Status & Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TemplateStatusPill
            isValid={template.isValid}
            warningCount={template.validationWarnings.length}
          />
          <span className="font-mono text-xs text-fg-2">v{template.version}</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onExport}
            disabled={isExporting}
            className="btn-secondary flex items-center gap-1.5"
          >
            {isExporting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            Export
          </button>
          <button
            onClick={onDelete}
            disabled={isDeleting}
            className="btn-secondary flex items-center gap-1.5 text-status-error"
          >
            {isDeleting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Trash2 className="w-3.5 h-3.5" />
            )}
            Delete
          </button>
        </div>
      </div>

      {/* Details */}
      <div className="space-y-4">
        <div className="bg-bg-1 rounded-md p-4">
          <h4 className="text-xs font-medium text-fg-2 uppercase tracking-wide mb-3">
            Template Details
          </h4>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-fg-2">ID</dt>
            <dd className="text-fg-1 font-mono">{template.id}</dd>
            <dt className="text-fg-2">Role</dt>
            <dd className="text-fg-1 font-mono">{template.role}</dd>
            <dt className="text-fg-2">Path</dt>
            <dd className="text-fg-1 font-mono text-xs truncate">{template.path}</dd>
            <dt className="text-fg-2">Updated</dt>
            <dd className="text-fg-1 font-mono text-xs">
              {new Date(template.updatedAt).toLocaleDateString()}
            </dd>
          </dl>
        </div>

        {/* Files indicator */}
        <div className="bg-bg-1 rounded-md p-4">
          <h4 className="text-xs font-medium text-fg-2 uppercase tracking-wide mb-3">
            Template Files
          </h4>
          <div className="flex flex-wrap gap-2">
            <span
              className={cn(
                'px-2 py-1 text-xs rounded-md',
                template.hasSoul
                  ? 'bg-status-success/10 text-status-success'
                  : 'bg-bg-2 text-fg-3'
              )}
            >
              {template.hasSoul ? <CheckCircle className="w-3 h-3 inline mr-1" /> : null}
              SOUL.md
            </span>
            <span
              className={cn(
                'px-2 py-1 text-xs rounded-md',
                template.hasOverlay
                  ? 'bg-status-success/10 text-status-success'
                  : 'bg-bg-2 text-fg-3'
              )}
            >
              {template.hasOverlay ? <CheckCircle className="w-3 h-3 inline mr-1" /> : null}
              overlay.md
            </span>
            <span
              className={cn(
                'px-2 py-1 text-xs rounded-md',
                template.hasReadme
                  ? 'bg-status-success/10 text-status-success'
                  : 'bg-bg-2 text-fg-3'
              )}
            >
              {template.hasReadme ? <CheckCircle className="w-3 h-3 inline mr-1" /> : null}
              README.md
            </span>
          </div>
        </div>

        {/* Config summary if present */}
        {template.config && (
          <div className="bg-bg-1 rounded-md p-4">
            <h4 className="text-xs font-medium text-fg-2 uppercase tracking-wide mb-3">
              Configuration
            </h4>
            <pre className="text-xs font-mono text-fg-1 overflow-auto max-h-[200px]">
              {JSON.stringify(template.config, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

function ReadmeTab({ template }: { template: TemplateWithFiles }) {
  if (!template.readme) {
    return (
      <EmptyState
        icon={<FileText className="w-8 h-8" />}
        title="No README"
        description="This template doesn't have a README.md file"
      />
    )
  }

  return (
    <div className="prose prose-sm prose-invert max-w-none">
      <div className="bg-bg-1 rounded-md p-4">
        <pre className="text-sm text-fg-1 whitespace-pre-wrap font-mono">{template.readme}</pre>
      </div>
    </div>
  )
}

function FilesTab({
  template,
  previewFile,
  isLoadingFile,
  onPreviewFile,
  onClosePreview,
}: {
  template: TemplateWithFiles
  previewFile: { name: string; content: string } | null
  isLoadingFile: boolean
  onPreviewFile: (file: TemplateFile) => void
  onClosePreview: () => void
}) {
  if (template.files.length === 0) {
    return (
      <EmptyState
        icon={<FolderOpen className="w-8 h-8" />}
        title="No files"
        description="This template has no files"
      />
    )
  }

  return (
    <div className="space-y-4">
      {/* File list */}
      <div className="bg-bg-1 rounded-md divide-y divide-bd-0">
        {template.files.map((file) => (
          <div
            key={file.id}
            className="flex items-center justify-between p-3 hover:bg-bg-2 transition-colors"
          >
            <div className="flex items-center gap-2">
              <FileCode className="w-4 h-4 text-fg-2" />
              <span className="text-sm font-mono text-fg-1">{file.name}</span>
            </div>
            <button
              onClick={() => onPreviewFile(file)}
              disabled={isLoadingFile}
              className="btn-secondary btn-sm flex items-center gap-1"
            >
              {isLoadingFile ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Eye className="w-3 h-3" />
              )}
              Preview
            </button>
          </div>
        ))}
      </div>

      {/* File preview */}
      {previewFile && (
        <div className="bg-bg-1 rounded-md">
          <div className="flex items-center justify-between p-3 border-b border-bd-0">
            <span className="text-sm font-mono text-fg-1">{previewFile.name}</span>
            <button onClick={onClosePreview} className="text-fg-2 hover:text-fg-0">
              <X className="w-4 h-4" />
            </button>
          </div>
          <pre className="p-4 text-xs font-mono text-fg-1 overflow-auto max-h-[400px]">
            {previewFile.content}
          </pre>
        </div>
      )}
    </div>
  )
}

function ValidationTab({ template }: { template: TemplateWithFiles }) {
  const hasErrors = template.validationErrors.length > 0
  const hasWarnings = template.validationWarnings.length > 0

  if (!hasErrors && !hasWarnings) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-center">
        <CheckCircle className="w-12 h-12 text-status-success mb-3" />
        <p className="text-fg-1 font-medium">Template is valid</p>
        <p className="text-sm text-fg-2">No errors or warnings found</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Errors */}
      {hasErrors && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-status-error flex items-center gap-2">
            <XCircle className="w-4 h-4" />
            Errors ({template.validationErrors.length})
          </h4>
          {template.validationErrors.map((error, idx) => (
            <div
              key={idx}
              className="p-3 bg-status-error/5 border border-status-error/30 rounded-md"
            >
              <p className="text-sm text-fg-1 font-mono">{error}</p>
            </div>
          ))}
        </div>
      )}

      {/* Warnings */}
      {hasWarnings && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-status-warning flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Warnings ({template.validationWarnings.length})
          </h4>
          {template.validationWarnings.map((warning, idx) => (
            <div
              key={idx}
              className="p-3 bg-status-warning/5 border border-status-warning/30 rounded-md"
            >
              <p className="text-sm text-fg-1 font-mono">{warning}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
