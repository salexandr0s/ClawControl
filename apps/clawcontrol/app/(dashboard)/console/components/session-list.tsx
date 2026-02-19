'use client'

import { useState, useMemo, useDeferredValue } from 'react'
import { Bot, Clock, AlertCircle, CheckCircle, Pause, RefreshCw, Search, X, DollarSign, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AgentAvatar } from '@/components/ui/agent-avatar'
import { LoadingSpinner } from '@/components/ui/loading-state'
import type { ConsoleSessionDTO } from '@/app/api/openclaw/console/sessions/route'
import type { AvailabilityStatus } from '@/lib/openclaw/availability'
import type { AgentDTO } from '@/lib/repo'

// ============================================================================
// TYPES
// ============================================================================

interface SessionListProps {
  sessions: ConsoleSessionDTO[]
  selectedId: string | null
  onSelect: (sessionId: string) => void
  gatewayStatus: AvailabilityStatus
  agentsBySessionKey: Record<string, AgentDTO>
  onSync: () => void
  syncing: boolean
  onEndSession: (session: ConsoleSessionDTO) => void
  endingSessionIds: Record<string, boolean>
  filters: {
    containsErrors: boolean
    toolUsed: string
  }
  onFiltersChange: (filters: {
    containsErrors: boolean
    toolUsed: string
  }) => void
}

type FilterState = 'all' | 'active' | 'idle' | 'error'
const PINNED_SESSION_KEY = 'agent:main:main'

// ============================================================================
// HELPERS
// ============================================================================

function formatRelativeTime(date: Date): string {
  const now = Date.now()
  const then = new Date(date).getTime()
  const diffMs = now - then

  if (diffMs < 60000) return 'just now'
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`
  if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h ago`
  return `${Math.floor(diffMs / 86400000)}d ago`
}

function getStateIcon(state: string) {
  switch (state) {
    case 'active':
      return <CheckCircle className="w-3 h-3 text-status-success" />
    case 'idle':
      return <Pause className="w-3 h-3 text-fg-3" />
    case 'error':
      return <AlertCircle className="w-3 h-3 text-status-danger" />
    default:
      return <Clock className="w-3 h-3 text-fg-3" />
  }
}

function formatMicrosToUsd(micros: string | null): string {
  if (!micros) return '—'
  const value = Number(micros) / 1_000_000
  if (!Number.isFinite(value)) return '—'
  return `$${value.toFixed(value >= 10 ? 2 : 4)}`
}

function formatCompactTokens(tokens: string | null): string {
  if (!tokens) return '—'
  const value = Number(tokens)
  if (!Number.isFinite(value)) return tokens
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

// ============================================================================
// COMPONENT
// ============================================================================

export function SessionList({
  sessions,
  selectedId,
  onSelect,
  gatewayStatus,
  agentsBySessionKey,
  onSync,
  syncing,
  onEndSession,
  endingSessionIds,
  filters,
  onFiltersChange,
}: SessionListProps) {
  const [filter, setFilter] = useState<FilterState>('all')
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)

  // Filter sessions
  const filteredSessions = useMemo(() => {
    const base = filter === 'all' ? sessions : sessions.filter(s => s.state === filter)
    const q = deferredQuery.trim().toLowerCase()
    const searched = q ? base.filter((s) => {
      const agent = agentsBySessionKey[s.sessionKey]
      const displayName = (agent?.name || s.agentId || '').toLowerCase()
      const sessionKey = (s.sessionKey || '').toLowerCase()
      const source = (s.source || '').toLowerCase()
      const kind = (s.kind || '').toLowerCase()
      const model = (s.model || '').toLowerCase()
      return (
        displayName.includes(q) ||
        sessionKey.includes(q) ||
        source.includes(q) ||
        kind.includes(q) ||
        model.includes(q)
      )
    }) : base

    const pinnedIndex = searched.findIndex((s) => s.sessionKey === PINNED_SESSION_KEY)
    if (pinnedIndex <= 0) return searched

    const ordered = searched.slice()
    const [pinned] = ordered.splice(pinnedIndex, 1)
    ordered.unshift(pinned)
    return ordered
  }, [sessions, filter, deferredQuery, agentsBySessionKey])

  // Count by state
  const counts = useMemo(() => {
    let active = 0
    let idle = 0
    let error = 0

    for (const s of sessions) {
      if (s.state === 'active') active++
      else if (s.state === 'idle') idle++
      else if (s.state === 'error') error++
    }

    return { all: sessions.length, active, idle, error }
  }, [sessions])

  return (
    <div className="w-60 border-r border-bd-0 flex flex-col bg-bg-1">
      {/* Header */}
      <div className="p-3 border-b border-bd-0 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium text-fg-1">Sessions</h2>
          <div className="text-xs text-fg-3 mt-0.5">
            {sessions.length} session{sessions.length !== 1 ? 's' : ''}
            {gatewayStatus !== 'ok' && (
              <span className="ml-1 text-status-warning">(cached)</span>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onSync}
          disabled={syncing}
          className={cn(
            'p-1.5 rounded-[var(--radius-sm)] transition-colors',
            syncing
              ? 'opacity-60 cursor-not-allowed text-fg-3'
              : 'hover:bg-bg-2 text-fg-2 hover:text-fg-0'
          )}
          title="Sync sessions"
        >
          <RefreshCw className={cn('w-4 h-4', syncing && 'animate-spin')} />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-bd-0">
        <div className="flex items-center gap-2 px-2 py-1.5 border border-bd-0 bg-bg-0 rounded-[var(--radius-md)]">
          <Search className="w-3.5 h-3.5 text-fg-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="w-full bg-transparent text-xs text-fg-0 placeholder:text-fg-3 focus:outline-none font-mono"
          />
        </div>
      </div>

      <div className="px-3 py-2 border-b border-bd-0 space-y-2">
        <label className="flex items-center justify-between text-xs text-fg-2">
          <span>Contains errors</span>
          <input
            type="checkbox"
            checked={filters.containsErrors}
            onChange={(e) => onFiltersChange({ ...filters, containsErrors: e.target.checked })}
          />
        </label>
        <input
          value={filters.toolUsed}
          onChange={(e) => onFiltersChange({ ...filters, toolUsed: e.target.value })}
          placeholder="Tool used"
          className="w-full px-2 py-1.5 text-xs bg-bg-0 border border-bd-0 rounded-[var(--radius-sm)] text-fg-0 placeholder:text-fg-3 focus:outline-none"
        />
      </div>

      {/* Filter chips */}
      <div className="p-2 border-b border-bd-0 flex flex-wrap gap-1">
        {(['all', 'active', 'idle', 'error'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-2 py-0.5 text-xs rounded transition-colors',
              filter === f
                ? 'bg-bg-3 text-fg-0'
                : 'text-fg-2 hover:bg-bg-2'
            )}
          >
            {f} ({counts[f]})
          </button>
        ))}
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {filteredSessions.length === 0 ? (
          <div className="p-4 text-center text-xs text-fg-3">
            No {filter !== 'all' ? filter : ''} sessions
          </div>
        ) : (
          <div className="divide-y divide-bd-0">
            {filteredSessions.map((session) => {
              const agent = agentsBySessionKey[session.sessionKey]
              const displayName = agent?.name || session.agentId
              const sessionTitle = session.sessionKey || session.sessionId
              const ending = Boolean(endingSessionIds[session.sessionId])

              return (
                <div
                  key={session.sessionId}
                  className={cn(
                    'relative',
                    selectedId === session.sessionId ? 'bg-bg-3' : 'hover:bg-bg-2'
                  )}
                >
                  <button
                    onClick={() => onSelect(session.sessionId)}
                    className="w-full p-3 pr-10 text-left transition-colors"
                  >
                  {/* Agent name + state */}
                  <div className="flex items-center gap-2">
                    {agent ? (
                      <AgentAvatar
                        agentId={agent.id}
                        name={agent.displayName || agent.name || session.agentId}
                        size="sm"
                        className="flex-shrink-0"
                      />
                    ) : (
                      <Bot className="w-4 h-4 text-status-progress flex-shrink-0" />
                    )}
                    <span
                      className="text-xs font-mono text-fg-0 break-all line-clamp-2 leading-snug"
                      title={session.sessionKey}
                    >
                      {sessionTitle}
                    </span>
                    <span className="px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[10px] font-medium bg-bg-2 text-fg-2 flex-shrink-0">
                      {session.source}
                    </span>
                    <div className="ml-auto flex-shrink-0">
                      {getStateIcon(session.state)}
                    </div>
                  </div>

                  {/* Session info */}
                  <div className="mt-1.5 flex items-center gap-2 text-xs text-fg-3">
                    <span className="truncate">{displayName}</span>
                    <span className="text-fg-3/50">·</span>
                    <span className="truncate">{session.kind}</span>
                    <span className="text-fg-3/50">·</span>
                    <span className="flex-shrink-0">
                      {formatRelativeTime(session.lastSeenAt)}
                    </span>
                  </div>

                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-fg-2">
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-bg-2">
                      <DollarSign className="w-3 h-3" />
                      {formatMicrosToUsd(session.totalCostMicros)}
                    </span>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-bg-2">
                      <Wrench className="w-3 h-3" />
                      {formatCompactTokens(session.totalTokens)} tok
                    </span>
                    {session.toolSummary.length > 0 && (
                      <span className="truncate max-w-[140px]">
                        {session.toolSummary.map((tool) => tool.name).join(', ')}
                      </span>
                    )}
                  </div>

                  {/* Context usage */}
                  {session.percentUsed !== null && (
                    <div className="mt-2">
                      <div className="h-1 bg-bg-3 rounded-full overflow-hidden">
                        <div
                          className={cn(
                            'h-full transition-all',
                            session.percentUsed > 80
                              ? 'bg-status-danger'
                              : session.percentUsed > 50
                                ? 'bg-status-warning'
                                : 'bg-status-success'
                          )}
                          style={{ width: `${session.percentUsed}%` }}
                        />
                      </div>
                      <div className="mt-0.5 text-[10px] text-fg-3">
                        {session.percentUsed}% context used
                      </div>
                    </div>
                  )}

                  {/* Error indicator */}
                  {(session.abortedLastRun || session.hasErrors) && (
                    <div className="mt-1.5 text-xs text-status-danger flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      <span>{session.abortedLastRun ? 'Last run aborted' : 'Contains errors'}</span>
                    </div>
                  )}
                  </button>

                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      if (ending) return
                      onEndSession(session)
                    }}
                    disabled={ending}
                    className={cn(
                      'absolute top-2.5 right-2.5 p-1 rounded-[var(--radius-sm)] transition-colors',
                      ending
                        ? 'text-fg-3/60 cursor-not-allowed'
                        : 'text-fg-3 hover:text-status-danger hover:bg-bg-1'
                    )}
                    title="End session"
                  >
                    {ending ? <LoadingSpinner size="sm" /> : <X className="w-3.5 h-3.5" />}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
