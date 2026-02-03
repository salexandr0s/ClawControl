'use client'

import { useState, useCallback } from 'react'
import { PageHeader, EmptyState, TypedConfirmModal } from '@savorg/ui'
import { RightDrawer } from '@/components/shell/right-drawer'
import { MarkdownEditor } from '@/components/editors/markdown-editor'
import { YamlEditor } from '@/components/editors/yaml-editor'
import { JsonEditor } from '@/components/editors/json-editor'
import { workspaceApi, HttpError } from '@/lib/http'
import { useProtectedAction } from '@/lib/hooks/useProtectedAction'
import type { ActionKind } from '@savorg/core'
import type { WorkspaceFileDTO } from '@/lib/data'
import { cn } from '@/lib/utils'
import {
  FolderTree,
  Folder,
  FileText,
  ChevronRight,
  FileCode,
  Loader2,
  Shield,
  Plus,
  FilePlus,
  FolderPlus,
  Trash2,
  X,
} from 'lucide-react'

// ============================================================================
// TYPES
// ============================================================================

interface Props {
  initialFiles: WorkspaceFileDTO[]
}

interface FileWithContent extends WorkspaceFileDTO {
  content?: string
}

// Protected file mapping
const PROTECTED_FILES: Record<string, { actionKind: ActionKind; label: string }> = {
  'AGENTS.md': { actionKind: 'config.agents_md.edit', label: 'Global Agent Configuration' },
  'routing.yaml': { actionKind: 'config.routing_template.edit', label: 'Routing Template' },
}

// ============================================================================
// COMPONENT
// ============================================================================

export function WorkspaceClient({ initialFiles }: Props) {
  const [currentPath, setCurrentPath] = useState('/')
  const [filesByPath, setFilesByPath] = useState<Record<string, WorkspaceFileDTO[]>>({
    '/': initialFiles,
  })

  const [selectedFile, setSelectedFile] = useState<FileWithContent | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string>('')

  const [showCreateMenu, setShowCreateMenu] = useState(false)
  const [createModalOpen, setCreateModalOpen] = useState<'file' | 'folder' | null>(null)
  const [newName, setNewName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const protectedAction = useProtectedAction()

  const files = filesByPath[currentPath] ?? []

  const breadcrumbs = currentPath
    .split('/')
    .filter(Boolean)
    .map((part, i, arr) => ({
      name: part,
      path: '/' + arr.slice(0, i + 1).join('/'),
    }))

  // Handle file click - open in drawer
  const handleFileClick = useCallback(async (file: WorkspaceFileDTO) => {
    if (file.type === 'folder') {
      const nextPath = file.path === '/' ? `/${file.name}` : `${file.path}/${file.name}`
      setCurrentPath(nextPath)

      // Lazy-load directory contents
      if (!filesByPath[nextPath]) {
        setIsLoading(true)
        setError(null)
        try {
          const result = await workspaceApi.list(nextPath)
          setFilesByPath((prev) => ({ ...prev, [nextPath]: result.data }))
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to load directory')
        } finally {
          setIsLoading(false)
        }
      }
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const result = await workspaceApi.get(file.id)
      setSelectedFile(result.data)
      setFileContent(result.data.content)
    } catch (err) {
      console.error('Failed to load file:', err)
      setError(err instanceof Error ? err.message : 'Failed to load file')
    } finally {
      setIsLoading(false)
    }
  }, [filesByPath])

  // Handle save
  const handleSave = useCallback(async (content: string): Promise<void> => {
    if (!selectedFile) return

    const protectedInfo = PROTECTED_FILES[selectedFile.name]

    // For protected files, trigger Governor confirmation
    if (protectedInfo) {
      return new Promise((resolve, reject) => {
        protectedAction.trigger({
          actionKind: protectedInfo.actionKind,
          actionTitle: `Edit ${protectedInfo.label}`,
          actionDescription: `You are editing "${selectedFile.name}". This is a protected configuration file that affects agent behavior.`,
          onConfirm: async (typedConfirmText) => {
            setIsSaving(true)
            setError(null)

            try {
              await workspaceApi.update(selectedFile.id, {
                content,
                typedConfirmText,
              })
              setSelectedFile((prev) => prev ? { ...prev, content } : null)
              setFileContent(content)
              resolve()
            } catch (err) {
              console.error('Failed to save file:', err)
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
    }

    // For non-protected files, save directly
    setIsSaving(true)
    setError(null)

    try {
      await workspaceApi.update(selectedFile.id, { content })
      setSelectedFile((prev) => prev ? { ...prev, content } : null)
      setFileContent(content)
    } catch (err) {
      console.error('Failed to save file:', err)
      if (err instanceof HttpError) {
        setError(err.message)
      }
      throw err
    } finally {
      setIsSaving(false)
    }
  }, [selectedFile, protectedAction])

  // Render the appropriate editor based on file type
  const renderEditor = () => {
    if (!selectedFile) return null

    const ext = selectedFile.name.split('.').pop()?.toLowerCase()

    const commonProps = {
      value: fileContent,
      onChange: setFileContent,
      onSave: handleSave,
      filePath: selectedFile.path === '/' ? selectedFile.name : `${selectedFile.path}/${selectedFile.name}`,
      isSaving,
      error,
      height: 'calc(100vh - 200px)',
    }

    switch (ext) {
      case 'md':
        return <MarkdownEditor {...commonProps} />
      case 'yaml':
      case 'yml':
        return <YamlEditor {...commonProps} />
      case 'json':
        return <JsonEditor {...commonProps} />
      default:
        // For unknown file types, use a basic text display
        return (
          <div>
            <p className="text-sm text-fg-2">
              No editor available for .{ext} files
            </p>
            <pre className="mt-4 p-4 bg-bg-3 rounded text-xs text-fg-1 overflow-auto">
              {fileContent}
            </pre>
          </div>
        )
    }
  }

  const navigateTo = useCallback(async (nextPath: string) => {
    setCurrentPath(nextPath)
    if (!filesByPath[nextPath]) {
      setIsLoading(true)
      setError(null)
      try {
        const result = await workspaceApi.list(nextPath)
        setFilesByPath((prev) => ({ ...prev, [nextPath]: result.data }))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load directory')
      } finally {
        setIsLoading(false)
      }
    }
  }, [filesByPath])

  // Handle create file/folder
  const handleCreate = useCallback((type: 'file' | 'folder') => {
    setCreateModalOpen(type)
    setNewName('')
    setShowCreateMenu(false)
    setError(null)
  }, [])

  const handleCreateSubmit = useCallback(() => {
    if (!createModalOpen || !newName.trim()) return

    const type = createModalOpen

    protectedAction.trigger({
      actionKind: 'action.caution',
      actionTitle: `Create ${type === 'file' ? 'File' : 'Folder'}`,
      actionDescription: `Create "${newName}" in ${currentPath === '/' ? 'workspace root' : currentPath}`,
      onConfirm: async (typedConfirmText) => {
        setIsCreating(true)
        setError(null)

        try {
          const result = await workspaceApi.create({
            path: currentPath,
            name: newName.trim(),
            type,
            typedConfirmText,
          })

          // Add to current path's files
          setFilesByPath((prev) => ({
            ...prev,
            [currentPath]: [...(prev[currentPath] ?? []), result.data],
          }))

          setCreateModalOpen(null)
          setNewName('')
        } catch (err) {
          console.error('Failed to create:', err)
          if (err instanceof HttpError) {
            setError(err.message)
          }
        } finally {
          setIsCreating(false)
        }
      },
      onError: (err) => {
        setError(err.message)
        setIsCreating(false)
      },
    })
  }, [createModalOpen, newName, currentPath, protectedAction])

  // Handle delete file/folder
  const handleDelete = useCallback((file: WorkspaceFileDTO) => {
    // Can't delete protected files
    if (PROTECTED_FILES[file.name]) {
      setError('Protected files cannot be deleted')
      return
    }

    protectedAction.trigger({
      actionKind: 'action.danger',
      actionTitle: `Delete ${file.type === 'folder' ? 'Folder' : 'File'}`,
      actionDescription: `Are you sure you want to delete "${file.name}"?${file.type === 'folder' ? ' This will delete all contents inside.' : ''}`,
      onConfirm: async (typedConfirmText) => {
        setIsDeleting(true)
        setError(null)

        try {
          await workspaceApi.delete(file.id, typedConfirmText)

          // Remove from current path's files
          setFilesByPath((prev) => ({
            ...prev,
            [currentPath]: (prev[currentPath] ?? []).filter((f) => f.id !== file.id),
          }))
        } catch (err) {
          console.error('Failed to delete:', err)
          if (err instanceof HttpError) {
            setError(err.message)
          }
        } finally {
          setIsDeleting(false)
        }
      },
      onError: (err) => {
        setError(err.message)
        setIsDeleting(false)
      },
    })
  }, [currentPath, protectedAction])

  return (
    <>
      <div className="w-full space-y-4">
        <PageHeader
          title="Workspace"
          subtitle={`${files.length} items`}
          actions={
            <div className="relative">
              <button
                onClick={() => setShowCreateMenu((prev) => !prev)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-bg-3 hover:bg-bd-1 rounded-[var(--radius-md)] border border-white/[0.06] text-fg-1"
              >
                <Plus className="w-3.5 h-3.5" />
                New
              </button>
              {showCreateMenu && (
                <div className="absolute right-0 top-full mt-1 bg-bg-3 border border-white/[0.08] rounded-[var(--radius-md)] shadow-lg z-10 min-w-[140px]">
                  <button
                    onClick={() => handleCreate('file')}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-fg-1 hover:bg-bg-2 transition-colors text-left"
                  >
                    <FilePlus className="w-4 h-4 text-fg-2" />
                    New File
                  </button>
                  <button
                    onClick={() => handleCreate('folder')}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-fg-1 hover:bg-bg-2 transition-colors text-left"
                  >
                    <FolderPlus className="w-4 h-4 text-fg-2" />
                    New Folder
                  </button>
                </div>
              )}
            </div>
          }
        />

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-sm">
          <button
            onClick={() => navigateTo('/')}
            className={cn(
              'px-2 py-1 rounded hover:bg-bg-3 transition-colors',
              currentPath === '/' ? 'text-fg-0' : 'text-fg-2'
            )}
          >
            workspace
          </button>
          {breadcrumbs.map((crumb) => (
            <div key={crumb.path} className="flex items-center gap-1">
              <ChevronRight className="w-3.5 h-3.5 text-fg-3" />
              <button
                onClick={() => navigateTo(crumb.path)}
                className="px-2 py-1 rounded hover:bg-bg-3 transition-colors text-fg-1"
              >
                {crumb.name}
              </button>
            </div>
          ))}
        </div>

        {/* File List */}
        <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-white/[0.06] overflow-hidden">
          {files.length > 0 ? (
            <div className="divide-y divide-white/[0.04]">
              {files.map((file) => (
                <FileRow
                  key={file.id}
                  file={file}
                  isProtected={!!PROTECTED_FILES[file.name]}
                  onClick={() => handleFileClick(file)}
                  onDelete={() => handleDelete(file)}
                  isDeleting={isDeleting}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<FolderTree className="w-8 h-8" />}
              title="Empty folder"
              description="No files in this directory"
            />
          )}
        </div>
      </div>

      {/* Editor Drawer */}
      <RightDrawer
        open={!!selectedFile}
        onClose={() => {
          setSelectedFile(null)
          setError(null)
        }}
        title={selectedFile?.name ?? ''}
        description={
          selectedFile && PROTECTED_FILES[selectedFile.name]
            ? 'Protected configuration file'
            : undefined
        }
        width="lg"
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-6 h-6 animate-spin text-fg-2" />
          </div>
        ) : (
          renderEditor()
        )}
      </RightDrawer>

      {/* Create Modal */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-bg-2 border border-white/[0.08] rounded-[var(--radius-lg)] p-6 w-full max-w-md mx-4 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-fg-0">
                New {createModalOpen === 'file' ? 'File' : 'Folder'}
              </h2>
              <button
                onClick={() => setCreateModalOpen(null)}
                className="p-1 hover:bg-bg-3 rounded"
              >
                <X className="w-4 h-4 text-fg-2" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-fg-2 mb-1.5">
                  Name
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={createModalOpen === 'file' ? 'example.md' : 'new-folder'}
                  className="w-full px-3 py-2 text-sm bg-bg-3 border border-white/[0.08] rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-3 focus:outline-none focus:ring-1 focus:ring-status-info/50"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newName.trim()) {
                      handleCreateSubmit()
                    }
                    if (e.key === 'Escape') {
                      setCreateModalOpen(null)
                    }
                  }}
                />
              </div>

              <div className="text-xs text-fg-3">
                Creating in: <span className="font-mono text-fg-2">{currentPath}</span>
              </div>

              {error && (
                <div className="p-2 text-xs text-status-danger bg-status-danger/10 border border-status-danger/20 rounded-[var(--radius-md)]">
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setCreateModalOpen(null)}
                  className="px-4 py-2 text-sm font-medium text-fg-2 hover:text-fg-1 hover:bg-bg-3 rounded-[var(--radius-md)]"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateSubmit}
                  disabled={!newName.trim() || isCreating}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-status-info text-white hover:bg-status-info/90 rounded-[var(--radius-md)] disabled:opacity-50"
                >
                  {isCreating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Create
                </button>
              </div>
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
        workOrderCode={protectedAction.state.workOrderCode}
        entityName={protectedAction.state.entityName}
        isLoading={protectedAction.state.isLoading}
      />
    </>
  )
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function FileRow({
  file,
  isProtected,
  onClick,
  onDelete,
  isDeleting,
}: {
  file: WorkspaceFileDTO
  isProtected: boolean
  onClick: () => void
  onDelete: () => void
  isDeleting: boolean
}) {
  const ext = file.name.split('.').pop()?.toLowerCase()
  const Icon = file.type === 'folder' ? Folder : getFileIcon(ext)

  return (
    <div className="flex items-center gap-3 p-3 hover:bg-bg-3/50 transition-colors group">
      <button
        onClick={onClick}
        className="flex-1 flex items-center gap-3 text-left"
      >
        <Icon className={cn(
          'w-4 h-4 shrink-0',
          file.type === 'folder' ? 'text-status-warning' : 'text-fg-2'
        )} />
        <span className="flex-1 text-sm text-fg-0">{file.name}</span>
        {isProtected && (
          <span title="Protected file">
            <Shield className="w-3.5 h-3.5 text-status-warning shrink-0" />
          </span>
        )}
        {file.size && (
          <span className="text-xs text-fg-2 font-mono">
            {formatFileSize(file.size)}
          </span>
        )}
        <span className="text-xs text-fg-2">
          {formatRelativeTime(file.modifiedAt)}
        </span>
        {file.type === 'folder' && (
          <ChevronRight className="w-4 h-4 text-fg-3" />
        )}
      </button>
      {!isProtected && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          disabled={isDeleting}
          className="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-status-danger/10 rounded transition-all"
          title="Delete"
        >
          <Trash2 className="w-3.5 h-3.5 text-status-danger" />
        </button>
      )}
    </div>
  )
}

function getFileIcon(ext?: string) {
  switch (ext) {
    case 'md':
      return FileText
    case 'yaml':
    case 'yml':
    case 'json':
      return FileCode
    default:
      return FileText
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatRelativeTime(date: Date | string): string {
  const now = new Date()
  const d = typeof date === 'string' ? new Date(date) : date
  const diff = now.getTime() - d.getTime()
  const days = Math.floor(diff / 86400000)

  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString()
}
