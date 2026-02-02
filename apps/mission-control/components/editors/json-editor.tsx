'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { oneDark } from '@codemirror/theme-one-dark'
import { cn } from '@/lib/utils'
import {
  Wand2,
  Save,
  Loader2,
  Check,
  AlertCircle,
  CheckCircle,
  XCircle,
} from 'lucide-react'

// ============================================================================
// TYPES
// ============================================================================

export interface JsonSchema {
  $schema?: string
  type?: string
  properties?: Record<string, unknown>
  required?: string[]
  [key: string]: unknown
}

export interface ValidationError {
  path: string
  message: string
}

export interface JsonEditorProps {
  /** Initial content */
  value: string
  /** Called when content changes */
  onChange?: (value: string) => void
  /** Called when save is requested */
  onSave?: (value: string) => Promise<void>
  /** JSON Schema for validation */
  schema?: JsonSchema
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
}

// ============================================================================
// VALIDATION
// ============================================================================

function validateJson(content: string): { valid: boolean; error?: string } {
  try {
    JSON.parse(content)
    return { valid: true }
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : 'Invalid JSON',
    }
  }
}

async function validateWithSchema(
  content: string,
  schema: JsonSchema
): Promise<ValidationError[]> {
  try {
    const data = JSON.parse(content)
    const Ajv = (await import('ajv')).default
    const ajv = new Ajv({ allErrors: true })
    const validate = ajv.compile(schema)
    const valid = validate(data)

    if (valid) return []

    return (validate.errors || []).map((err: { instancePath?: string; message?: string }) => ({
      path: err.instancePath || '/',
      message: err.message || 'Validation error',
    }))
  } catch (err) {
    return [
      {
        path: '/',
        message: err instanceof Error ? err.message : 'Validation failed',
      },
    ]
  }
}

// ============================================================================
// PRETTIFY
// ============================================================================

function prettifyJson(content: string): string {
  try {
    const parsed = JSON.parse(content)
    return JSON.stringify(parsed, null, 2)
  } catch {
    throw new Error('Cannot prettify invalid JSON')
  }
}

// ============================================================================
// COMPONENT
// ============================================================================

export function JsonEditor({
  value,
  onChange,
  onSave,
  schema,
  placeholder = '{}',
  readOnly = false,
  filePath,
  isSaving = false,
  error,
  height = '400px',
}: JsonEditorProps) {
  const [content, setContent] = useState(value)
  const [isPrettifying, setIsPrettifying] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [syntaxError, setSyntaxError] = useState<string | null>(null)
  const [schemaErrors, setSchemaErrors] = useState<ValidationError[]>([])
  const editorRef = useRef<HTMLDivElement>(null)

  // Sync external value changes
  useEffect(() => {
    setContent(value)
    setHasChanges(false)
  }, [value])

  // Validate on content change
  useEffect(() => {
    const validation = validateJson(content)
    setSyntaxError(validation.valid ? null : validation.error || null)

    if (validation.valid && schema) {
      validateWithSchema(content, schema).then(setSchemaErrors)
    } else {
      setSchemaErrors([])
    }
  }, [content, schema])

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
  const handlePrettify = useCallback(() => {
    setIsPrettifying(true)
    try {
      const formatted = prettifyJson(content)
      handleChange(formatted)
    } catch {
      // Error already handled in validation
    } finally {
      setIsPrettifying(false)
    }
  }, [content, handleChange])

  // Handle save
  const handleSave = useCallback(async () => {
    if (!onSave || isSaving) return
    if (syntaxError) return // Don't save invalid JSON
    if (schema && schemaErrors.length > 0) return // Don't save if schema invalid

    await onSave(content)
    setHasChanges(false)
  }, [content, onSave, isSaving, syntaxError, schema, schemaErrors])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey

      // Cmd/Ctrl + Shift + F = Prettify
      if (isMod && e.shiftKey && e.key === 'f') {
        e.preventDefault()
        if (!readOnly && !syntaxError) handlePrettify()
      }

      // Cmd/Ctrl + S = Save
      if (isMod && e.key === 's') {
        e.preventDefault()
        if (!readOnly && onSave) handleSave()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [readOnly, handlePrettify, handleSave, onSave, syntaxError])

  // Validation status
  const isValid = !syntaxError && schemaErrors.length === 0
  const canSave = isValid && hasChanges && !isSaving

  return (
    <div
      ref={editorRef}
      className="flex flex-col bg-bg-2 rounded-[var(--radius-lg)] border border-white/[0.06] overflow-hidden"
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06] bg-bg-1">
        {/* File path + validation status */}
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
          {/* Validation indicator */}
          {content.trim() && (
            <span
              className={cn(
                'flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded',
                isValid
                  ? 'bg-status-success/10 text-status-success'
                  : 'bg-status-error/10 text-status-error'
              )}
            >
              {isValid ? (
                <CheckCircle className="w-3 h-3" />
              ) : (
                <XCircle className="w-3 h-3" />
              )}
              {isValid ? 'Valid' : 'Invalid'}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          {/* Prettify */}
          {!readOnly && (
            <button
              onClick={handlePrettify}
              disabled={isPrettifying || !!syntaxError}
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
              disabled={!canSave}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-[var(--radius-sm)] transition-colors disabled:opacity-50',
                canSave
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
      {(error || syntaxError) && (
        <div className="flex items-center gap-2 px-3 py-2 bg-status-error/10 border-b border-status-error/30">
          <AlertCircle className="w-4 h-4 text-status-error shrink-0" />
          <span className="text-xs text-status-error">{error || syntaxError}</span>
        </div>
      )}

      {/* Schema Validation Errors */}
      {schemaErrors.length > 0 && (
        <div className="px-3 py-2 bg-status-warning/10 border-b border-status-warning/30 space-y-1">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-status-warning shrink-0" />
            <span className="text-xs font-medium text-status-warning">
              Schema Validation Errors
            </span>
          </div>
          <ul className="text-xs text-status-warning space-y-0.5 ml-6">
            {schemaErrors.map((err, i) => (
              <li key={i}>
                <code className="text-[10px] bg-bg-3 px-1 rounded">{err.path}</code>
                : {err.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Editor */}
      <div className="flex-1 overflow-hidden" style={{ height }}>
        <CodeMirror
          value={content}
          onChange={handleChange}
          extensions={[json()]}
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
    </div>
  )
}
