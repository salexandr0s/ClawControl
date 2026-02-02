'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import ReactMarkdown from 'react-markdown'
import { cn } from '@/lib/utils'
import {
  Edit3,
  Eye,
  Columns,
  Wand2,
  Save,
  Loader2,
  Check,
  AlertCircle,
} from 'lucide-react'

// ============================================================================
// TYPES
// ============================================================================

export type EditorMode = 'edit' | 'preview' | 'split'

export interface MarkdownEditorProps {
  /** Initial content */
  value: string
  /** Called when content changes */
  onChange?: (value: string) => void
  /** Called when save is requested */
  onSave?: (value: string) => Promise<void>
  /** Placeholder text */
  placeholder?: string
  /** Whether the editor is read-only */
  readOnly?: boolean
  /** File path for display */
  filePath?: string
  /** Whether save is in progress */
  isSaving?: boolean
  /** Error message to display */
  error?: string | null
  /** Height of the editor */
  height?: string
  /** Initial mode */
  initialMode?: EditorMode
}

// ============================================================================
// PRETTIFY
// ============================================================================

async function prettifyMarkdown(content: string): Promise<string> {
  try {
    const prettier = await import('prettier/standalone')
    const markdownPlugin = await import('prettier/plugins/markdown')

    const formatted = await prettier.format(content, {
      parser: 'markdown',
      plugins: [markdownPlugin],
      proseWrap: 'preserve',
      tabWidth: 2,
    })

    return formatted
  } catch (err) {
    console.error('Prettify failed:', err)
    throw new Error('Failed to format markdown')
  }
}

// ============================================================================
// COMPONENT
// ============================================================================

export function MarkdownEditor({
  value,
  onChange,
  onSave,
  placeholder = 'Enter markdown...',
  readOnly = false,
  filePath,
  isSaving = false,
  error,
  height = '400px',
  initialMode = 'split',
}: MarkdownEditorProps) {
  const [mode, setMode] = useState<EditorMode>(initialMode)
  const [content, setContent] = useState(value)
  const [isPrettifying, setIsPrettifying] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)

  // Sync external value changes
  useEffect(() => {
    setContent(value)
    setHasChanges(false)
  }, [value])

  // Handle content change
  const handleChange = useCallback(
    (newValue: string) => {
      setContent(newValue)
      setHasChanges(newValue !== value)
      onChange?.(newValue)
    },
    [value, onChange]
  )

  // Handle prettify
  const handlePrettify = useCallback(async () => {
    setIsPrettifying(true)
    try {
      const formatted = await prettifyMarkdown(content)
      handleChange(formatted)
    } catch {
      // Error already logged
    } finally {
      setIsPrettifying(false)
    }
  }, [content, handleChange])

  // Handle save
  const handleSave = useCallback(async () => {
    if (!onSave || isSaving) return
    await onSave(content)
    setHasChanges(false)
  }, [content, onSave, isSaving])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey

      // Cmd/Ctrl + Shift + F = Prettify
      if (isMod && e.shiftKey && e.key === 'f') {
        e.preventDefault()
        if (!readOnly) handlePrettify()
      }

      // Cmd/Ctrl + S = Save
      if (isMod && e.key === 's') {
        e.preventDefault()
        if (!readOnly && onSave) handleSave()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [readOnly, handlePrettify, handleSave, onSave])

  return (
    <div
      ref={editorRef}
      className="flex flex-col bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0 overflow-hidden"
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-bd-0 bg-bg-1">
        {/* File path */}
        <div className="flex items-center gap-2 min-w-0">
          {filePath && (
            <span className="text-xs font-mono text-fg-2 truncate max-w-[300px]">
              {filePath}
            </span>
          )}
          {hasChanges && (
            <span className="px-1.5 py-0.5 text-[10px] bg-status-warning/10 text-status-warning rounded">
              Unsaved
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          {/* Mode Toggle */}
          <div className="flex items-center bg-bg-3 rounded-[var(--radius-sm)] p-0.5">
            <button
              onClick={() => setMode('edit')}
              className={cn(
                'p-1.5 rounded-[var(--radius-xs)] transition-colors',
                mode === 'edit'
                  ? 'bg-bg-2 text-fg-0'
                  : 'text-fg-2 hover:text-fg-1'
              )}
              title="Edit mode"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setMode('split')}
              className={cn(
                'p-1.5 rounded-[var(--radius-xs)] transition-colors',
                mode === 'split'
                  ? 'bg-bg-2 text-fg-0'
                  : 'text-fg-2 hover:text-fg-1'
              )}
              title="Split mode"
            >
              <Columns className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setMode('preview')}
              className={cn(
                'p-1.5 rounded-[var(--radius-xs)] transition-colors',
                mode === 'preview'
                  ? 'bg-bg-2 text-fg-0'
                  : 'text-fg-2 hover:text-fg-1'
              )}
              title="Preview mode"
            >
              <Eye className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Prettify */}
          {!readOnly && (
            <button
              onClick={handlePrettify}
              disabled={isPrettifying}
              className="flex items-center gap-1 px-2 py-1.5 text-xs text-fg-2 hover:text-fg-1 hover:bg-bg-3 rounded-[var(--radius-sm)] transition-colors disabled:opacity-50"
              title="Format (Cmd/Ctrl+Shift+F)"
            >
              {isPrettifying ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Wand2 className="w-3.5 h-3.5" />
              )}
              Prettify
            </button>
          )}

          {/* Save */}
          {onSave && !readOnly && (
            <button
              onClick={handleSave}
              disabled={isSaving || !hasChanges}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-[var(--radius-sm)] transition-colors disabled:opacity-50',
                hasChanges
                  ? 'bg-status-info text-white hover:bg-status-info/90'
                  : 'text-fg-2 hover:text-fg-1 hover:bg-bg-3'
              )}
              title="Save (Cmd/Ctrl+S)"
            >
              {isSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : hasChanges ? (
                <Save className="w-3.5 h-3.5" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              {isSaving ? 'Saving...' : hasChanges ? 'Save' : 'Saved'}
            </button>
          )}
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 bg-status-error/10 border-b border-status-error/30">
          <AlertCircle className="w-4 h-4 text-status-error shrink-0" />
          <span className="text-xs text-status-error">{error}</span>
        </div>
      )}

      {/* Editor Content */}
      <div
        className={cn(
          'flex-1 overflow-hidden',
          mode === 'split' && 'grid grid-cols-2 divide-x divide-bd-0'
        )}
        style={{ height }}
      >
        {/* Editor Pane */}
        {mode !== 'preview' && (
          <div className="h-full overflow-auto">
            <CodeMirror
              value={content}
              onChange={handleChange}
              extensions={[markdown()]}
              theme={oneDark}
              placeholder={placeholder}
              readOnly={readOnly}
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                highlightActiveLine: true,
                highlightSelectionMatches: true,
                autocompletion: true,
                bracketMatching: true,
              }}
              className="h-full text-sm"
              style={{ height: '100%' }}
            />
          </div>
        )}

        {/* Preview Pane */}
        {mode !== 'edit' && (
          <div className="h-full overflow-auto p-4 bg-bg-1">
            <div className="prose prose-sm prose-invert max-w-none">
              <ReactMarkdown
                components={{
                  p: ({ children }) => (
                    <p className="text-sm text-fg-1 mb-3 last:mb-0">{children}</p>
                  ),
                  ul: ({ children }) => (
                    <ul className="text-sm text-fg-1 list-disc pl-4 mb-3 space-y-1">
                      {children}
                    </ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="text-sm text-fg-1 list-decimal pl-4 mb-3 space-y-1">
                      {children}
                    </ol>
                  ),
                  li: ({ children }) => <li className="text-fg-1">{children}</li>,
                  h1: ({ children }) => (
                    <h1 className="text-xl font-bold text-fg-0 mt-6 mb-3 first:mt-0">
                      {children}
                    </h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="text-lg font-semibold text-fg-0 mt-5 mb-2">
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="text-base font-semibold text-fg-0 mt-4 mb-2">
                      {children}
                    </h3>
                  ),
                  h4: ({ children }) => (
                    <h4 className="text-sm font-semibold text-fg-0 mt-3 mb-1">
                      {children}
                    </h4>
                  ),
                  code: ({ children, className }) => {
                    const isInline = !className
                    if (isInline) {
                      return (
                        <code className="px-1.5 py-0.5 bg-bg-3 rounded text-xs font-mono text-fg-1">
                          {children}
                        </code>
                      )
                    }
                    return (
                      <code className="text-xs font-mono text-fg-1">{children}</code>
                    )
                  },
                  pre: ({ children }) => (
                    <pre className="p-3 bg-bg-3 rounded-[var(--radius-md)] overflow-x-auto text-xs font-mono text-fg-1 mb-3">
                      {children}
                    </pre>
                  ),
                  a: ({ href, children }) => (
                    <a
                      href={href}
                      className="text-status-info hover:underline"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {children}
                    </a>
                  ),
                  strong: ({ children }) => (
                    <strong className="font-semibold text-fg-0">{children}</strong>
                  ),
                  em: ({ children }) => (
                    <em className="italic text-fg-1">{children}</em>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-2 border-bd-1 pl-3 text-fg-2 italic mb-3">
                      {children}
                    </blockquote>
                  ),
                  table: ({ children }) => (
                    <table className="w-full text-sm border-collapse mb-3">
                      {children}
                    </table>
                  ),
                  thead: ({ children }) => (
                    <thead className="bg-bg-3">{children}</thead>
                  ),
                  th: ({ children }) => (
                    <th className="px-3 py-2 text-left text-xs font-medium text-fg-1 border border-bd-0">
                      {children}
                    </th>
                  ),
                  td: ({ children }) => (
                    <td className="px-3 py-2 text-fg-1 border border-bd-0">
                      {children}
                    </td>
                  ),
                  hr: () => <hr className="border-bd-0 my-4" />,
                }}
              >
                {content || '_No content_'}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
