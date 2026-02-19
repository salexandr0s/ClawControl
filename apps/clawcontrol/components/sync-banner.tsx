'use client'

import { AlertTriangle, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSyncStatus } from '@/lib/hooks/useSyncStatus'
import { useGatewayStatus } from '@/lib/hooks/useGatewayStatus'

export function SyncBanner({ className, withMargin = true }: { className?: string; withMargin?: boolean }) {
  const { status, loading, syncing, triggerSync } = useSyncStatus()
  const { status: gatewayStatus, loading: gatewayLoading } = useGatewayStatus()

  if (loading || !status) return null

  if (!gatewayLoading && gatewayStatus === 'unavailable') {
    return (
      <div
        className={cn(
          withMargin && 'mb-3',
          'flex items-center gap-2 rounded-[var(--radius-md)] border border-status-danger bg-status-danger/10 px-3 py-2 text-xs text-status-danger',
          className
        )}
      >
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>OpenClaw gateway is offline. Data may be stale.</span>
      </div>
    )
  }

  const bootError = status.bootSync?.agents.error || status.bootSync?.sessions.error

  if (bootError) {
    return (
      <div
        className={cn(
          withMargin && 'mb-3',
          'flex items-center gap-2 rounded-[var(--radius-md)] border border-status-warning bg-status-warning/10 px-3 py-2 text-xs text-status-warning',
          className
        )}
      >
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="truncate">OpenClaw sync failed at boot: {bootError}</span>
        <button
          type="button"
          onClick={() => void triggerSync()}
          disabled={syncing}
          className="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium hover:bg-status-warning/[0.15] disabled:opacity-60"
        >
          <RefreshCw className={syncing ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
          {syncing ? 'Syncing...' : 'Retry'}
        </button>
      </div>
    )
  }

  if (status.stale) {
    return (
      <div
        className={cn(
          withMargin && 'mb-3',
          'flex items-center gap-2 rounded-[var(--radius-md)] border border-status-warning bg-status-warning/10 px-3 py-2 text-xs text-status-warning',
          className
        )}
      >
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>OpenClaw data is stale.</span>
        <button
          type="button"
          onClick={() => void triggerSync()}
          disabled={syncing}
          className="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium hover:bg-status-warning/[0.15] disabled:opacity-60"
        >
          <RefreshCw className={syncing ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
          {syncing ? 'Syncing...' : 'Sync now'}
        </button>
      </div>
    )
  }

  return null
}
