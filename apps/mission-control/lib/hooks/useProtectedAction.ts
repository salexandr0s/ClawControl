'use client'

import { useState, useCallback } from 'react'
import {
  ACTION_POLICIES,
  type ActionKind,
  type ActionPolicy,
  type RiskLevel,
  type ConfirmMode,
} from '@savorgos/core'

// ============================================================================
// TYPES
// ============================================================================

export interface ProtectedActionState {
  isOpen: boolean
  isLoading: boolean
  actionKind: ActionKind | null
  actionTitle: string
  actionDescription: string
  workOrderCode?: string
  entityName?: string
}

export interface ProtectedActionConfig {
  actionKind: ActionKind
  actionTitle: string
  actionDescription: string
  workOrderCode?: string
  entityName?: string
  /** Called with the typed confirm text when user confirms */
  onConfirm: (typedConfirmText: string) => Promise<void>
  onError?: (error: Error) => void
}

export interface UseProtectedActionReturn {
  state: ProtectedActionState
  policy: ActionPolicy | null
  riskLevel: RiskLevel
  confirmMode: ConfirmMode
  trigger: (config: ProtectedActionConfig) => void
  confirm: (typedConfirmText: string) => Promise<void>
  cancel: () => void
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook to wrap actions with Governor policy enforcement.
 * Shows TypedConfirmModal when the action requires confirmation.
 */
export function useProtectedAction(): UseProtectedActionReturn {
  const [state, setState] = useState<ProtectedActionState>({
    isOpen: false,
    isLoading: false,
    actionKind: null,
    actionTitle: '',
    actionDescription: '',
  })

  const [pendingConfig, setPendingConfig] = useState<ProtectedActionConfig | null>(null)

  const policy = state.actionKind ? ACTION_POLICIES[state.actionKind] : null
  const riskLevel: RiskLevel = policy?.riskLevel ?? 'safe'
  const confirmMode: ConfirmMode = policy?.confirmMode ?? 'NONE'

  const trigger = useCallback((config: ProtectedActionConfig) => {
    const actionPolicy = ACTION_POLICIES[config.actionKind]

    // If no confirmation required, execute immediately (pass empty string)
    if (actionPolicy.confirmMode === 'NONE') {
      config.onConfirm('').catch((err) => {
        config.onError?.(err instanceof Error ? err : new Error(String(err)))
      })
      return
    }

    // Show confirmation modal
    setPendingConfig(config)
    setState({
      isOpen: true,
      isLoading: false,
      actionKind: config.actionKind,
      actionTitle: config.actionTitle,
      actionDescription: config.actionDescription,
      workOrderCode: config.workOrderCode,
      entityName: config.entityName,
    })
  }, [])

  const confirm = useCallback(async (typedConfirmText: string) => {
    if (!pendingConfig) return

    setState((prev) => ({ ...prev, isLoading: true }))

    try {
      await pendingConfig.onConfirm(typedConfirmText)
      setState({
        isOpen: false,
        isLoading: false,
        actionKind: null,
        actionTitle: '',
        actionDescription: '',
      })
      setPendingConfig(null)
    } catch (err) {
      setState((prev) => ({ ...prev, isLoading: false }))
      pendingConfig.onError?.(err instanceof Error ? err : new Error(String(err)))
    }
  }, [pendingConfig])

  const cancel = useCallback(() => {
    setState({
      isOpen: false,
      isLoading: false,
      actionKind: null,
      actionTitle: '',
      actionDescription: '',
    })
    setPendingConfig(null)
  }, [])

  return {
    state,
    policy,
    riskLevel,
    confirmMode,
    trigger,
    confirm,
    cancel,
  }
}
