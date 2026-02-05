'use client'

import { useState, useMemo, useDeferredValue } from 'react'
import { Bot, Clock, AlertCircle, CheckCircle, Pause, RefreshCw, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { StationIcon } from '@/components/station-icon'
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
}

type FilterState = 'all' | 'active' | 'idle' | 'error'

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
}: SessionListProps) {
  const [filter, setFilter] = useState<FilterState>('all')
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)

  // Filter sessions
  const filteredSessions = useMemo(() => {
    const base = filter === 'all' ? sessions : sessions.filter(s => s.state === filter)
    const q = deferredQuery.trim().toLowerCase()
    if (!q) return base

    return base.filter((s) => {
      const agent = agentsBySessionKey[s.sessionKey]
      const displayName = (agent?.name || s.agentId || '').toLowerCase()
      const sessionKey = (s.sessionKey || '').toLowerCase()
      const kind = (s.kind || '').toLowerCase()
      const model = (s.model || '').toLowerCase()
      return (
        displayName.includes(q) ||
        sessionKey.includes(q) ||
        kind.includes(q) ||
        model.includes(q)
      )
    })
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

              return (
                <button
                  key={session.sessionId}
                  onClick={() => onSelect(session.sessionId)}
                  className={cn(
                    'w-full p-3 text-left transition-colors',
                    selectedId === session.sessionId
                      ? 'bg-bg-3'
                      : 'hover:bg-bg-2'
                  )}
                >
                  {/* Agent name + state */}
                  <div className="flex items-center gap-2">
                    {agent ? (
                      <StationIcon stationId={agent.station} size="md" className="flex-shrink-0" />
                    ) : (
                      <Bot className="w-4 h-4 text-status-progress flex-shrink-0" />
                    )}
                    <span className="text-sm font-mono text-fg-0 truncate">
                      {displayName}
                    </span>
                    <div className="ml-auto flex-shrink-0">
                      {getStateIcon(session.state)}
                    </div>
                  </div>

                  {/* Session info */}
                  <div className="mt-1.5 flex items-center gap-2 text-xs text-fg-3">
                    <span className="truncate">{session.kind}</span>
                    <span className="text-fg-3/50">·</span>
                    <span className="flex-shrink-0">
                      {formatRelativeTime(session.lastSeenAt)}
                    </span>
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
                  {session.abortedLastRun && (
                    <div className="mt-1.5 text-xs text-status-danger flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      <span>Last run aborted</span>
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
