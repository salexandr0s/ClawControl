'use client'

import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { RefreshCw, Bot, Clock, AlertTriangle, Activity } from 'lucide-react'

type SessionRow = {
  id: string
  sessionId: string
  sessionKey: string
  agentId: string
  kind: string
  model: string | null
  lastSeenAt: string
  percentUsed: number | null
  abortedLastRun: boolean
  state: string
}

function formatAgo(iso: string): string {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const secs = Math.floor(diff / 1000)
  const mins = Math.floor(secs / 60)
  if (secs < 5) return 'now'
  if (secs < 60) return `${secs}s`
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h`
}

export function OpenClawSessionsPanel() {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null)

  async function syncAndLoad() {
    setLoading(true)
    setError(null)
    try {
      await fetch('/api/openclaw/sessions/sync', { method: 'POST' })
      const res = await fetch('/api/openclaw/sessions?limit=200')
      const json = (await res.json()) as { data: SessionRow[] }
      setSessions(json.data)
      setLastSyncAt(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to sync sessions')
    } finally {
      setLoading(false)
    }
  }

  // Poll every 5s (telemetry only)
  useEffect(() => {
    syncAndLoad()
    const t = setInterval(syncAndLoad, 5000)
    return () => clearInterval(t)
  }, [])

  const byAgent = useMemo(() => {
    const m = new Map<string, SessionRow[]>()
    for (const s of sessions) {
      const arr = m.get(s.agentId) ?? []
      arr.push(s)
      m.set(s.agentId, arr)
    }
    for (const [k, arr] of m) {
      arr.sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())
      m.set(k, arr)
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [sessions])

  return (
    <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-white/[0.06] p-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-fg-2" />
          <div>
            <div className="text-xs font-semibold text-fg-0">OpenClaw Sessions (Telemetry)</div>
            <div className="text-[11px] text-fg-3 flex items-center gap-2">
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {lastSyncAt ? `synced ${Math.floor((Date.now() - lastSyncAt.getTime()) / 1000)}s ago` : 'not synced'}
              </span>
              <span className="text-fg-3">·</span>
              <span className="text-fg-2">{sessions.length} sessions</span>
            </div>
          </div>
        </div>

        <button
          onClick={syncAndLoad}
          className={cn(
            'btn-secondary flex items-center gap-1.5 text-xs',
            loading && 'opacity-70'
          )}
          disabled={loading}
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          Sync
        </button>
      </div>

      {error && (
        <div className="text-xs text-status-danger flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {byAgent.map(([agentId, rows]) => {
          // TTL visual expiry (2 min): fade anything older than 2 min
          return (
            <div key={agentId} className="rounded-md border border-white/[0.06] bg-bg-1 p-2">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Bot className="w-3.5 h-3.5 text-fg-2" />
                  <span className="text-xs font-mono text-fg-0">{agentId}</span>
                </div>
                <span className="text-[11px] text-fg-3">{rows.length}</span>
              </div>

              <div className="space-y-1">
                {rows.slice(0, 6).map((s) => {
                  const ageMs = Date.now() - new Date(s.lastSeenAt).getTime()
                  const stale = ageMs > 120_000
                  return (
                    <div
                      key={s.sessionId}
                      className={cn(
                        'flex items-center justify-between gap-2 px-2 py-1 rounded bg-bg-2 border border-white/[0.06]',
                        stale && 'opacity-50'
                      )}
                    >
                      <div className="min-w-0">
                        <div className="text-[11px] text-fg-1 truncate font-mono">{s.sessionKey}</div>
                        <div className="text-[10px] text-fg-3 truncate">
                          {s.kind} · {s.model ?? '—'}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className={cn('text-[11px] font-mono', s.state === 'active' ? 'text-status-progress' : s.state === 'error' ? 'text-status-danger' : 'text-fg-2')}>
                          {s.state}
                        </div>
                        <div className="text-[10px] text-fg-3">
                          {formatAgo(s.lastSeenAt)}{typeof s.percentUsed === 'number' ? ` · ${s.percentUsed}%` : ''}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <div className="text-[11px] text-fg-3">
        Telemetry only: sessions never create/mutate WorkOrders or Operations.
      </div>
    </div>
  )
}
