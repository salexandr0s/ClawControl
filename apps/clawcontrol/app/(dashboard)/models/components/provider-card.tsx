'use client'

import { cn } from '@/lib/utils'
import type { AvailableModelProvider } from '@/lib/http'
import { AlertTriangle, CheckCircle, PlusCircle, XCircle } from 'lucide-react'

export function ProviderCard({
  provider,
  selected,
  onClick,
}: {
  provider: AvailableModelProvider
  selected: boolean
  onClick: () => void
}) {
  const isConfigured = provider.authStatus === 'ok' || provider.authStatus === 'expiring'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!provider.supported}
      className={cn(
        'flex items-start justify-between gap-3 w-full text-left p-3 rounded-[var(--radius-md)] border transition-colors',
        selected ? 'bg-bg-2 border-bd-1' : 'bg-bg-3 border-bd-0 hover:bg-bg-2',
        !provider.supported && 'opacity-50 cursor-not-allowed'
      )}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium text-fg-0 truncate">{provider.label}</div>
        <div className="text-xs text-fg-3 font-mono truncate">{provider.id}</div>
      </div>
      <div className="shrink-0 mt-0.5">
        {!provider.supported ? (
          <XCircle className="w-4 h-4 text-fg-3" />
        ) : provider.authStatus === 'expired' ? (
          <AlertTriangle className="w-4 h-4 text-status-warning" />
        ) : isConfigured ? (
          <CheckCircle className="w-4 h-4 text-status-success" />
        ) : (
          <PlusCircle className="w-4 h-4 text-fg-3" />
        )}
      </div>
    </button>
  )
}
