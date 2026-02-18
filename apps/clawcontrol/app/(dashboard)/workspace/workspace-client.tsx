'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  PageHeader,
  EmptyState,
  TypedConfirmModal,
  Button,
  DropdownMenu,
  SelectDropdown,
} from '@clawcontrol/ui'
import { LoadingSpinner, LoadingState } from '@/components/ui/loading-state'
import { RightDrawer } from '@/components/shell/right-drawer'
import { MarkdownEditor } from '@/components/editors/markdown-editor'
import { YamlEditor } from '@/components/editors/yaml-editor'
import { JsonEditor } from '@/components/editors/json-editor'
import { workspaceApi, workspaceFavoritesApi, HttpError } from '@/lib/http'
import { useProtectedAction } from '@/lib/hooks/useProtectedAction'
import { useSettings } from '@/lib/settings-context'
import type { ActionKind } from '@clawcontrol/core'
import type { WorkspaceFileDTO } from '@/lib/data'
import { cn } from '@/lib/utils'
import {
  FolderTree,
  Folder,
  FileText,
  ChevronRight,
  FileCode,
  Shield,
  Plus,
  FilePlus,
  FolderPlus,
  Trash2,
  X,
  Star,
  Search,
} from 'lucide-react'

interface Props {
  initialFiles: WorkspaceFileDTO[]
}

interface FileWithContent extends WorkspaceFileDTO {
  content?: string
}

type WorkspaceSort = 'name' | 'recentlyEdited' | 'newestCreated' | 'oldestCreated'

interface FavoritesDoc {
  favorites: string[]
  recents: Array<{ path: string; touchedAt: string }>
  pinToday?: boolean
}

const PROTECTED_FILES: Record<string, { actionKind: ActionKind; label: string }> = {
  'AGENTS.md': { actionKind: 'config.agents_md.edit', label: 'Global Agent Configuration' },
  'routing.yaml': { actionKind: 'config.routing_template.edit', label: 'Routing Template' },
}

function toEntryPath(file: WorkspaceFileDTO): string {
  return file.path === '/' ? `/${file.name}` : `${file.path}/${file.name}`
}

export function WorkspaceClient({ initialFiles }: Props) {
  const { skipTypedConfirm } = useSettings()
  const [currentPath, setCurrentPath] = useState('/')
  const [filesByPath, setFilesByPath] = useState<Record<string, WorkspaceFileDTO[]>>({
    '/': initialFiles,
  })

  const [selectedFile, setSelectedFile] = useState<FileWithContent | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string>('')

  const [createModalOpen, setCreateModalOpen] = useState<'file' | 'folder' | null>(null)
  const [newName, setNewName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [sortBy, setSortBy] = useState<WorkspaceSort>('name')
  const [searchQuery, setSearchQuery] = useState('')
  const [favoritesDoc, setFavoritesDoc] = useState<FavoritesDoc>({ favorites: [], recents: [] })

  const protectedAction = useProtectedAction({ skipTypedConfirm })

  const files = useMemo(() => {
    const base = [...(filesByPath[currentPath] ?? [])]

    base.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1

      if (sortBy === 'recentlyEdited') {
        return new Date(b.lastEditedAt).getTime() - new Date(a.lastEditedAt).getTime()
      }

      if (sortBy === 'newestCreated') {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : Number.NEGATIVE_INFINITY
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : Number.NEGATIVE_INFINITY
        return bTime - aTime
      }

      if (sortBy === 'oldestCreated') {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : Number.POSITIVE_INFINITY
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : Number.POSITIVE_INFINITY
        return aTime - bTime
      }

      return a.name.localeCompare(b.name)
    })

    return base
  }, [filesByPath, currentPath, sortBy])

  const normalizedSearch = useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery])
  const filteredFiles = useMemo(() => {
    if (!normalizedSearch) return files

    return files.filter((file) => {
      const entryPath = toEntryPath(file).toLowerCase()
      return file.name.toLowerCase().includes(normalizedSearch) || entryPath.includes(normalizedSearch)
    })
  }, [files, normalizedSearch])

  const favoriteSet = useMemo(() => new Set(favoritesDoc.favorites), [favoritesDoc.favorites])
  const recentsByPath = useMemo(
    () => new Map(favoritesDoc.recents.map((item) => [item.path, item.touchedAt])),
    [favoritesDoc.recents]
  )

  const favoriteEntries = useMemo(
    () => filteredFiles.filter((file) => favoriteSet.has(toEntryPath(file))),
    [filteredFiles, favoriteSet]
  )

  const recentEntries = useMemo(
    () => filteredFiles.filter((file) => recentsByPath.has(toEntryPath(file)) && !favoriteSet.has(toEntryPath(file))),
    [filteredFiles, recentsByPath, favoriteSet]
  )

  const regularEntries = useMemo(
    () => filteredFiles.filter((file) => !favoriteSet.has(toEntryPath(file)) && !recentsByPath.has(toEntryPath(file))),
    [filteredFiles, favoriteSet, recentsByPath]
  )

  const hasFilteredEntries = filteredFiles.length > 0
  const listSubtitle = normalizedSearch
    ? `${filteredFiles.length} of ${files.length} items`
    : `${files.length} items`

  const breadcrumbs = currentPath
    .split('/')
    .filter(Boolean)
    .map((part, i, arr) => ({
      name: part,
      path: '/' + arr.slice(0, i + 1).join('/'),
    }))

  useEffect(() => {
    const loadFavorites = async () => {
      try {
        const result = await workspaceFavoritesApi.get()
        setFavoritesDoc(result.data)
      } catch {
        // Keep UX functional even when favorites file is unavailable.
      }
    }
    void loadFavorites()
  }, [])

  const handleFileClick = useCallback(async (file: WorkspaceFileDTO) => {
    const entryPath = toEntryPath(file)

    if (file.type === 'folder') {
      const nextPath = file.path === '/' ? `/${file.name}` : `${file.path}/${file.name}`
      setCurrentPath(nextPath)

      if (!filesByPath[nextPath]) {
        setIsLoading(true)
        setError(null)
        try {
          const result = await workspaceApi.list(nextPath, { sort: sortBy })
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
      try {
        const recents = await workspaceFavoritesApi.touchRecent(entryPath)
        setFavoritesDoc(recents.data)
      } catch {
        // Non-blocking; file opening should still work.
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file')
    } finally {
      setIsLoading(false)
    }
  }, [filesByPath, sortBy])

  const handleSave = useCallback(async (content: string): Promise<void> => {
    if (!selectedFile) return

    const protectedInfo = PROTECTED_FILES[selectedFile.name]

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

    setIsSaving(true)
    setError(null)

    try {
      await workspaceApi.update(selectedFile.id, { content })
      setSelectedFile((prev) => prev ? { ...prev, content } : null)
      setFileContent(content)
    } catch (err) {
      if (err instanceof HttpError) {
        setError(err.message)
      }
      throw err
    } finally {
      setIsSaving(false)
    }
  }, [selectedFile, protectedAction])

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
        return <MarkdownEditor {...commonProps} initialMode="edit" />
      case 'yaml':
      case 'yml':
        return <YamlEditor {...commonProps} />
      case 'json':
        return <JsonEditor {...commonProps} />
      default:
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
        const result = await workspaceApi.list(nextPath, { sort: sortBy })
        setFilesByPath((prev) => ({ ...prev, [nextPath]: result.data }))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load directory')
      } finally {
        setIsLoading(false)
      }
    }
  }, [filesByPath, sortBy])

  const handleCreate = useCallback((type: 'file' | 'folder') => {
    setCreateModalOpen(type)
    setNewName('')
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

          setFilesByPath((prev) => ({
            ...prev,
            [currentPath]: [...(prev[currentPath] ?? []), result.data],
          }))

          setCreateModalOpen(null)
          setNewName('')
        } catch (err) {
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

  const handleDelete = useCallback((file: WorkspaceFileDTO) => {
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

          setFilesByPath((prev) => ({
            ...prev,
            [currentPath]: (prev[currentPath] ?? []).filter((f) => f.id !== file.id),
          }))
        } catch (err) {
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

  const handleFavoriteToggle = useCallback(async (file: WorkspaceFileDTO) => {
    const path = toEntryPath(file)
    try {
      const result = await workspaceFavoritesApi.update('toggle', path)
      setFavoritesDoc(result.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update favorites')
    }
  }, [])

  return (
    <>
      <div className="w-full space-y-4">
        <PageHeader
          title="Workspace"
          subtitle={listSubtitle}
          actions={
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 w-3.5 h-3.5 -translate-y-1/2 text-fg-3" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter files..."
                  className="w-[220px] pl-7 pr-2 py-1.5 text-xs bg-bg-3 border border-bd-0 rounded-[var(--radius-md)] text-fg-1 placeholder:text-fg-3 focus:outline-none focus:border-bd-1"
                />
              </div>

              <SelectDropdown
                value={sortBy}
                onChange={(nextValue) => setSortBy(nextValue as WorkspaceSort)}
                ariaLabel="Workspace sort"
                tone="toolbar"
                size="sm"
                options={[
                  { value: 'name', label: 'Sort: Name', textValue: 'sort name' },
                  { value: 'recentlyEdited', label: 'Sort: Recently Edited', textValue: 'sort recently edited' },
                  { value: 'newestCreated', label: 'Sort: Newest Created', textValue: 'sort newest created' },
                  { value: 'oldestCreated', label: 'Sort: Oldest Created', textValue: 'sort oldest created' },
                ]}
              />

              <DropdownMenu
                trigger={
                  <>
                    <Plus className="w-3.5 h-3.5" />
                    New
                  </>
                }
                ariaLabel="Create workspace item"
                size="sm"
                align="end"
                menuWidth={170}
                className="bg-bg-2"
                items={[
                  {
                    id: 'file',
                    label: 'New File',
                    icon: <FilePlus className="w-4 h-4" />,
                  },
                  {
                    id: 'folder',
                    label: 'New Folder',
                    icon: <FolderPlus className="w-4 h-4" />,
                  },
                ]}
                onSelect={(itemId) => handleCreate(itemId)}
              />
            </div>
          }
        />

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

        <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0 overflow-hidden">
          {hasFilteredEntries ? (
            <div>
              <div className="grid grid-cols-[1fr_140px_140px_110px] gap-3 px-3 py-2 border-b border-bd-0 text-[11px] text-fg-2">
                <span>Name</span>
                <span>Created</span>
                <span>Last Edited</span>
                <span className="text-right">Size</span>
              </div>

              {favoriteEntries.length > 0 && (
                <SectionHeader title="Favorites" />
              )}
              <div className="divide-y divide-bd-0">
                {favoriteEntries.map((file) => (
                  <FileRow
                    key={file.id}
                    file={file}
                    isProtected={!!PROTECTED_FILES[file.name]}
                    isFavorite
                    onToggleFavorite={() => handleFavoriteToggle(file)}
                    onClick={() => handleFileClick(file)}
                    onDelete={() => handleDelete(file)}
                    isDeleting={isDeleting}
                  />
                ))}
              </div>

              {recentEntries.length > 0 && (
                <SectionHeader title="Recent" />
              )}
              <div className="divide-y divide-bd-0">
                {recentEntries.map((file) => (
                  <FileRow
                    key={file.id}
                    file={file}
                    isProtected={!!PROTECTED_FILES[file.name]}
                    isFavorite={favoriteSet.has(toEntryPath(file))}
                    onToggleFavorite={() => handleFavoriteToggle(file)}
                    onClick={() => handleFileClick(file)}
                    onDelete={() => handleDelete(file)}
                    isDeleting={isDeleting}
                  />
                ))}
              </div>

              {regularEntries.length > 0 && (favoriteEntries.length > 0 || recentEntries.length > 0) && (
                <SectionHeader title="All Files" />
              )}
              <div className="divide-y divide-bd-0">
                {regularEntries.map((file) => (
                  <FileRow
                    key={file.id}
                    file={file}
                    isProtected={!!PROTECTED_FILES[file.name]}
                    isFavorite={favoriteSet.has(toEntryPath(file))}
                    onToggleFavorite={() => handleFavoriteToggle(file)}
                    onClick={() => handleFileClick(file)}
                    onDelete={() => handleDelete(file)}
                    isDeleting={isDeleting}
                  />
                ))}
              </div>
            </div>
          ) : files.length > 0 && normalizedSearch ? (
            <EmptyState
              icon={<Search className="w-8 h-8" />}
              title="No matching files"
              description={`No files match "${searchQuery.trim()}" in this folder.`}
            />
          ) : (
            <EmptyState
              icon={<FolderTree className="w-8 h-8" />}
              title="Empty folder"
              description="No files in this directory"
            />
          )}
        </div>
      </div>

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
        width="xl"
      >
        {isLoading ? (
          <LoadingState />
        ) : (
          renderEditor()
        )}
      </RightDrawer>

      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-bg-2 border border-bd-1 rounded-[var(--radius-lg)] p-6 w-full max-w-md mx-4 shadow-xl">
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
                  className="w-full px-3 py-2 text-sm bg-bg-3 border border-bd-1 rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-3 focus:outline-none focus:ring-1 focus:ring-status-info/50"
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
                <Button
                  onClick={() => setCreateModalOpen(null)}
                  variant="secondary"
                  size="md"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateSubmit}
                  disabled={!newName.trim() || isCreating}
                  variant="primary"
                  size="md"
                >
                  {isCreating && <LoadingSpinner size="sm" />}
                  Create
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

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

function FileRow({
  file,
  isProtected,
  isFavorite,
  onToggleFavorite,
  onClick,
  onDelete,
  isDeleting,
}: {
  file: WorkspaceFileDTO
  isProtected: boolean
  isFavorite: boolean
  onToggleFavorite: () => void
  onClick: () => void
  onDelete: () => void
  isDeleting: boolean
}) {
  const ext = file.name.split('.').pop()?.toLowerCase()
  const Icon = file.type === 'folder' ? Folder : getFileIcon(ext)

  return (
    <div className="group">
      <div className="grid grid-cols-[1fr_140px_140px_110px] gap-3 p-3 hover:bg-bg-3/50 transition-colors items-center">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggleFavorite()
            }}
            className="p-1 rounded hover:bg-bg-2"
            title={isFavorite ? 'Remove favorite' : 'Add favorite'}
          >
            <Star className={cn('w-3.5 h-3.5', isFavorite ? 'text-status-warning fill-status-warning' : 'text-fg-3')} />
          </button>
          <button
            onClick={onClick}
            className="flex-1 flex items-center gap-2 text-left min-w-0"
          >
            <Icon className={cn(
              'w-4 h-4 shrink-0',
              file.type === 'folder' ? 'text-status-warning' : 'text-fg-2'
            )} />
            <span className="truncate text-sm text-fg-0">{file.name}</span>
            {isProtected && (
              <span title="Protected file">
                <Shield className="w-3.5 h-3.5 text-status-warning shrink-0" />
              </span>
            )}
            {file.type === 'folder' && (
              <ChevronRight className="w-4 h-4 text-fg-3 shrink-0" />
            )}
          </button>
        </div>

        <span className="text-xs text-fg-2">{file.createdAt ? formatDateTime(file.createdAt) : '—'}</span>
        <span className="text-xs text-fg-2">{formatDateTime(file.lastEditedAt)}</span>
        <div className="flex items-center justify-end gap-2">
          {file.size ? <span className="text-xs text-fg-2 font-mono">{formatFileSize(file.size)}</span> : <span className="text-xs text-fg-3">—</span>}
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
      </div>
    </div>
  )
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="px-3 py-2 bg-bg-3/60 border-y border-bd-0 text-[11px] uppercase tracking-wide text-fg-2">
      {title}
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

function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
