'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { TypedConfirmModal } from '@savorgos/ui'
import { useProtectedAction, type ProtectedActionConfig } from '@/lib/hooks/useProtectedAction'

// ============================================================================
// CONTEXT
// ============================================================================

interface ProtectedActionContextValue {
  trigger: (config: ProtectedActionConfig) => void
}

const ProtectedActionContext = createContext<ProtectedActionContextValue | null>(null)

// ============================================================================
// PROVIDER
// ============================================================================

interface ProtectedActionProviderProps {
  children: ReactNode
}

/**
 * Provider component that wraps the app and provides the protected action modal.
 * Use the `useProtectedActionTrigger` hook to access the trigger function.
 */
export function ProtectedActionProvider({ children }: ProtectedActionProviderProps) {
  const { state, riskLevel, confirmMode, trigger, confirm, cancel } = useProtectedAction()

  return (
    <ProtectedActionContext.Provider value={{ trigger }}>
      {children}
      <TypedConfirmModal
        isOpen={state.isOpen}
        onClose={cancel}
        onConfirm={confirm}
        confirmMode={confirmMode}
        riskLevel={riskLevel}
        actionTitle={state.actionTitle}
        actionDescription={state.actionDescription}
        workOrderCode={state.workOrderCode}
        entityName={state.entityName}
        isLoading={state.isLoading}
      />
    </ProtectedActionContext.Provider>
  )
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook to access the protected action trigger.
 * Must be used within a ProtectedActionProvider.
 */
export function useProtectedActionTrigger() {
  const context = useContext(ProtectedActionContext)
  if (!context) {
    throw new Error('useProtectedActionTrigger must be used within a ProtectedActionProvider')
  }
  return context.trigger
}
