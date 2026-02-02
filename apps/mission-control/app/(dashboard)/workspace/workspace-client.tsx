'use client'

import { useState, useCallback } from 'react'
import { PageHeader, EmptyState, TypedConfirmModal } from '@savorg/ui'
import { RightDrawer } from '@/components/shell/right-drawer'
import { MarkdownEditor } from '@/components/editors/markdown-editor'
import { YamlEditor } from '@/components/editors/yaml-editor'
import { JsonEditor } from '@/components/editors/json-editor'
import { workspaceApi, HttpError } from '@/lib/http'
import { useProtectedAction } from '@/lib/hooks/useProtectedAction'
import { ACTION_POLICIES, type ActionKind } from '@savorg/core'
import type { WorkspaceFileDTO } from '@/lib/data'
import { cn } from '@/lib/utils'
import {
  FolderTree,
  Folder,
  FileText,
  ChevronRight,
  Upload,
  Plus,
  FileCode,
  Loader2,
  Shield,
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

  return (
    <>
      <div className="w-full space-y-4">
        <PageHeader
          title="Workspace"
          subtitle={`${files.length} items`}
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
}: {
  file: WorkspaceFileDTO
  isProtected: boolean
  onClick: () => void
}) {
  const ext = file.name.split('.').pop()?.toLowerCase()
  const Icon = file.type === 'folder' ? Folder : getFileIcon(ext)

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 hover:bg-bg-3/50 transition-colors text-left"
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
