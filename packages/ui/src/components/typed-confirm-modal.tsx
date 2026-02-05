'use client'

import { useState, useEffect, useCallback } from 'react'
import { AlertTriangle, ShieldAlert, ShieldCheck, X, Terminal } from 'lucide-react'

// ============================================================================
// TYPES
// ============================================================================

export type ConfirmMode = 'NONE' | 'CONFIRM' | 'WO_CODE'
export type RiskLevel = 'safe' | 'caution' | 'danger'

export interface TypedConfirmModalProps {
  /** Whether the modal is open */
  isOpen: boolean
  /** Close the modal */
  onClose: () => void
  /** Called when confirmation is successful, receives the typed confirm text */
  onConfirm: (typedConfirmText: string) => void
  /** The confirmation mode required */
  confirmMode: ConfirmMode
  /** Risk level affects styling */
  riskLevel: RiskLevel
  /** Action title (e.g., "Restart Gateway") */
  actionTitle: string
  /** What will happen when confirmed */
  actionDescription: string
  /** Optional: Work Order code for WO_CODE mode */
  workOrderCode?: string
  /** Optional: Entity being affected */
  entityName?: string
  /** Whether the action is in progress */
  isLoading?: boolean
}

// ============================================================================
// COMPONENT
// ============================================================================

export function TypedConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  confirmMode,
  riskLevel,
  actionTitle,
  actionDescription,
  workOrderCode,
  entityName,
  isLoading = false,
}: TypedConfirmModalProps) {
  const [inputValue, setInputValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setInputValue('')
      setError(null)
    }
  }, [isOpen])

  // Get the expected confirmation value
  const getExpectedValue = useCallback((): string => {
    switch (confirmMode) {
      case 'CONFIRM':
        return 'CONFIRM'
      case 'WO_CODE':
        return workOrderCode || ''
      default:
        return ''
    }
  }, [confirmMode, workOrderCode])

  // Check if input matches expected value
  const isValid = useCallback((): boolean => {
    if (confirmMode === 'NONE') return true
    return inputValue.trim().toUpperCase() === getExpectedValue().toUpperCase()
  }, [confirmMode, inputValue, getExpectedValue])

  // Handle confirmation
  const handleConfirm = useCallback(() => {
    if (confirmMode !== 'NONE' && !isValid()) {
      setError(`Please type "${getExpectedValue()}" to confirm`)
      return
    }
    // Pass the typed confirm text (the expected value for consistency)
    const confirmText = confirmMode === 'NONE' ? '' : inputValue.trim().toUpperCase()
    onConfirm(confirmText)
  }, [confirmMode, isValid, getExpectedValue, onConfirm, inputValue])

  // Handle key press
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && isValid() && !isLoading) {
        handleConfirm()
      }
      if (e.key === 'Escape') {
        onClose()
      }
    },
    [isValid, isLoading, handleConfirm, onClose]
  )

  if (!isOpen) return null

  // Risk level styling
  const riskConfig = {
    safe: {
      icon: ShieldCheck,
      iconClass: 'text-status-success',
      bgClass: 'bg-status-success/10',
      borderClass: 'border-status-success/30',
      label: 'Safe Action',
    },
    caution: {
      icon: AlertTriangle,
      iconClass: 'text-status-warning',
      bgClass: 'bg-status-warning/10',
      borderClass: 'border-status-warning/30',
      label: 'Caution Required',
    },
    danger: {
      icon: ShieldAlert,
      iconClass: 'text-status-error',
      bgClass: 'bg-status-error/10',
      borderClass: 'border-status-error/30',
      label: 'Dangerous Action',
    },
  }

  const config = riskConfig[riskLevel]
  const RiskIcon = config.icon

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md mx-4 bg-bg-1 border border-bd-0 rounded-[var(--radius-lg)] shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-bd-0">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-[var(--radius-md)] ${config.bgClass}`}>
              <RiskIcon className={`w-5 h-5 ${config.iconClass}`} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-fg-0">{actionTitle}</h2>
              <span className={`text-xs ${config.iconClass}`}>{config.label}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-[var(--radius-sm)] hover:bg-bg-3 transition-colors"
          >
            <X className="w-4 h-4 text-fg-2" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {/* Description */}
          <div className="text-sm text-fg-1">{actionDescription}</div>

          {/* Entity info */}
          {entityName && (
            <div className="flex items-center gap-2 px-3 py-2 bg-bg-3 rounded-[var(--radius-md)]">
              <Terminal className="w-4 h-4 text-fg-2" />
              <span className="text-xs font-mono text-fg-1">{entityName}</span>
            </div>
          )}

          {/* Confirmation input */}
          {confirmMode !== 'NONE' && (
            <div className="space-y-2">
              <label className="block text-xs text-fg-2">
                Type{' '}
                <code className="px-1.5 py-0.5 bg-bg-3 rounded text-status-warning font-mono">
                  {getExpectedValue()}
                </code>{' '}
                to confirm
              </label>
              <input
                type="text"
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value)
                  setError(null)
                }}
                onKeyDown={handleKeyDown}
                placeholder={getExpectedValue()}
                autoFocus
                className={`w-full px-3 py-2 text-sm font-mono bg-bg-2 border rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-3 focus:outline-none focus:ring-1 ${
                  error
                    ? 'border-status-error focus:ring-status-error'
                    : 'border-bd-1 focus:ring-status-progress'
                }`}
              />
              {error && (
                <p className="text-xs text-status-error">{error}</p>
              )}
            </div>
          )}

          {/* Receipt notice */}
          <div className="flex items-center gap-2 px-3 py-2 bg-bg-2 rounded-[var(--radius-md)] border border-bd-0">
            <span className="text-xs text-fg-2">
              This action will be logged in the activity stream
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-bd-0">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-fg-1 bg-bg-3 rounded-[var(--radius-md)] hover:bg-bg-2 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isLoading || (confirmMode !== 'NONE' && !isValid())}
            className={`px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              riskLevel === 'danger'
                ? 'bg-status-error text-white hover:bg-status-error/80'
                : riskLevel === 'caution'
                ? 'bg-status-warning text-black hover:bg-status-warning/80'
                : 'bg-status-success text-white hover:bg-status-success/80'
            }`}
          >
            {isLoading ? 'Processing...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}
