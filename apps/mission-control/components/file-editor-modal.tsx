'use client'

import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { X, Save, Loader2, FileCode, AlertCircle } from 'lucide-react'
import { workspaceApi } from '@/lib/http'
import { TypedConfirmModal } from '@savorg/ui'
import { useProtectedAction } from '@/lib/hooks/useProtectedAction'
import type { ActionKind } from '@savorg/core'

interface FileEditorModalProps {
  isOpen: boolean
  onClose: () => void
  filePath: string // e.g., "/agents/savorgbuild.md"
  fileName: string // e.g., "savorgbuild.md"
  onSaved?: () => void
}

// Protected files require confirmation
const PROTECTED_FILES: Record<string, ActionKind> = {
  'AGENTS.md': 'config.agents_md.edit',
  'routing.yaml': 'config.routing_template.edit',
}

export function FileEditorModal({
  isOpen,
  onClose,
  filePath,
  fileName,
  onSaved,
}: FileEditorModalProps) {
  const [content, setContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const protectedAction = useProtectedAction()

  // Determine if this is a protected file
  const isProtected = Object.keys(PROTECTED_FILES).some((f) => fileName.endsWith(f))
  const actionKind = Object.entries(PROTECTED_FILES).find(([f]) => fileName.endsWith(f))?.[1]

  // Load file content
  useEffect(() => {
    if (!isOpen) return

    async function loadFile() {
      setLoading(true)
      setError(null)
      try {
        // Encode the path to get the file ID
        const fileId = Buffer.from(filePath, 'utf8').toString('base64url')
        const result = await workspaceApi.get(fileId)
        setContent(result.data.content || '')
        setOriginalContent(result.data.content || '')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load file')
      } finally {
        setLoading(false)
      }
    }

    loadFile()
  }, [isOpen, filePath])

  const hasChanges = content !== originalContent

  const handleSave = async (typedConfirmText?: string) => {
    if (!hasChanges) return

    setSaving(true)
    setError(null)

    try {
      const fileId = Buffer.from(filePath, 'utf8').toString('base64url')
      await workspaceApi.update(fileId, { content, typedConfirmText })
      setOriginalContent(content)
      onSaved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save file')
      throw err
    } finally {
      setSaving(false)
    }
  }

  const handleSaveClick = () => {
    if (isProtected && actionKind) {
      protectedAction.trigger({
        actionKind,
        actionTitle: `Edit ${fileName}`,
        actionDescription: `Save changes to protected file ${fileName}`,
        entityName: fileName,
        onConfirm: handleSave,
      })
    } else {
      handleSave()
    }
  }

  if (!isOpen) return null

  return (
    <>
      {/* Full-screen modal */}
      <div className="fixed inset-0 z-50 flex flex-col bg-bg-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] bg-bg-1">
          <div className="flex items-center gap-3">
            <FileCode className="w-5 h-5 text-fg-2" />
            <div>
              <h2 className="text-sm font-semibold text-fg-0">{fileName}</h2>
              <p className="text-xs text-fg-3">{filePath}</p>
            </div>
            {isProtected && (
              <span className="px-2 py-0.5 text-[10px] uppercase tracking-wide bg-status-warning/10 text-status-warning rounded">
                Protected
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveClick}
              disabled={!hasChanges || saving}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-[var(--radius-md)] transition-colors',
                hasChanges
                  ? 'bg-status-progress text-white hover:bg-status-progress/90'
                  : 'bg-bg-3 text-fg-3 cursor-not-allowed'
              )}
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Save
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-bg-3 rounded-[var(--radius-md)] text-fg-2 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="flex items-center gap-2 px-4 py-2 bg-status-danger/10 text-status-danger text-sm">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        {/* Editor */}
        <div className="flex-1 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-6 h-6 animate-spin text-fg-2" />
            </div>
          ) : (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full h-full p-4 font-mono text-sm bg-bg-0 text-fg-0 border-none outline-none resize-none"
              spellCheck={false}
            />
          )}
        </div>

        {/* Status bar */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-white/[0.06] bg-bg-1 text-xs text-fg-3">
          <span>{content.split('\n').length} lines</span>
          <span>{hasChanges ? 'Modified' : 'Saved'}</span>
        </div>
      </div>

      {/* Confirmation modal */}
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
