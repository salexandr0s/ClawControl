'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { EmptyState } from '@clawcontrol/ui'
import { Terminal, AlertCircle, RefreshCw } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { agentsApi } from '@/lib/http'
import { useGatewayChat } from '@/lib/hooks/useGatewayChat'
import { useChatStore, type ChatMessage } from '@/lib/stores/chat-store'
import type { PromptSubmitPayload } from '@/components/prompt-kit'
import { SessionList } from './components/session-list'
import { ChatPanel } from './components/chat-panel'
import type { ConsoleSessionDTO } from '@/app/api/openclaw/console/sessions/route'
import type { AvailabilityStatus } from '@/lib/openclaw/availability'
import type { AgentDTO } from '@/lib/repo'

// ============================================================================
// TYPES
// ============================================================================

interface SessionsApiResponse {
  status: AvailabilityStatus
  data: ConsoleSessionDTO[]
  gatewayAvailable: boolean
  cached: boolean
  timestamp: string
  error?: string
}

interface SessionQueryFilters {
  containsErrors: boolean
  minCostUsd: string
  toolUsed: string
}

// ============================================================================
// CONSTANTS
// ============================================================================

const POLL_INTERVAL_MS = 5000
const RETRY_INTERVALS = [1000, 2000, 5000, 10000, 30000]

function areConsoleSessionsEquivalent(a: ConsoleSessionDTO[], b: ConsoleSessionDTO[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false

  for (let i = 0; i < a.length; i++) {
    const prev = a[i]
    const next = b[i]
    if (prev.sessionId !== next.sessionId) return false
    if (prev.source !== next.source) return false
    if (prev.state !== next.state) return false
    if (prev.percentUsed !== next.percentUsed) return false
    if (prev.abortedLastRun !== next.abortedLastRun) return false
    if (prev.totalTokens !== next.totalTokens) return false
    if (prev.totalCostMicros !== next.totalCostMicros) return false
    if (prev.hasErrors !== next.hasErrors) return false
    if ((prev.toolSummary?.length ?? 0) !== (next.toolSummary?.length ?? 0)) return false
    for (let t = 0; t < (prev.toolSummary?.length ?? 0); t++) {
      if (prev.toolSummary[t]?.name !== next.toolSummary[t]?.name) return false
      if (prev.toolSummary[t]?.count !== next.toolSummary[t]?.count) return false
    }
    if (String(prev.lastSeenAt) !== String(next.lastSeenAt)) return false
    if (String(prev.updatedAt) !== String(next.updatedAt)) return false
  }

  return true
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function ConsoleClient() {
  // State
  const [sessions, setSessions] = useState<ConsoleSessionDTO[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [gatewayStatus, setGatewayStatus] = useState<AvailabilityStatus>('ok')
  const [gatewayAvailable, setGatewayAvailable] = useState(true)
  const [agentsBySessionKey, setAgentsBySessionKey] = useState<Record<string, AgentDTO>>({})
  const [syncingSessions, setSyncingSessions] = useState(false)
  const [endingSessionIds, setEndingSessionIds] = useState<Record<string, boolean>>({})
  const [queryFilters, setQueryFilters] = useState<SessionQueryFilters>({
    containsErrors: false,
    minCostUsd: '',
    toolUsed: '',
  })

  // Refs for retry logic
  const retryCountRef = useRef(0)
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const { sendMessage, abort } = useGatewayChat()
  const {
    messages,
    isStreaming,
    currentRunId,
    chatError,
    setError: setChatError,
    resetChat,
    setMessages: setChatMessages,
  } = useChatStore(
    useShallow((s) => ({
      messages: s.messages,
      isStreaming: s.isStreaming,
      currentRunId: s.currentRunId,
      chatError: s.error,
      setError: s.setError,
      resetChat: s.resetChat,
      setMessages: s.setMessages,
    }))
  )

  // ============================================================================
  // DATA FETCHING
  // ============================================================================

  const fetchSessions = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (queryFilters.containsErrors) params.set('containsErrors', 'true')
      if (queryFilters.toolUsed.trim()) params.set('toolUsed', queryFilters.toolUsed.trim())
      if (queryFilters.minCostUsd.trim()) {
        const parsed = Number(queryFilters.minCostUsd)
        if (Number.isFinite(parsed) && parsed > 0) {
          params.set('minCostMicros', String(Math.round(parsed * 1_000_000)))
        }
      }

      const res = await fetch(`/api/openclaw/console/sessions${params.toString() ? `?${params.toString()}` : ''}`)
      const data: SessionsApiResponse = await res.json()

      setSessions((prev) => (areConsoleSessionsEquivalent(prev, data.data) ? prev : data.data))
      setGatewayStatus((prev) => (prev === data.status ? prev : data.status))
      setGatewayAvailable((prev) => (prev === data.gatewayAvailable ? prev : data.gatewayAvailable))
      setError(null)
      retryCountRef.current = 0 // Reset retry count on success
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch sessions')
      setGatewayAvailable(false)
      setGatewayStatus('unavailable')

      // Exponential backoff
      const retryIndex = Math.min(retryCountRef.current, RETRY_INTERVALS.length - 1)
      retryCountRef.current++

      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }

      setTimeout(() => {
        fetchSessions()
      }, RETRY_INTERVALS[retryIndex])
    } finally {
      setLoading(false)
    }
  }, [queryFilters.containsErrors, queryFilters.minCostUsd, queryFilters.toolUsed])

  const fetchAgents = useCallback(async () => {
    try {
      const res = await agentsApi.list()
      setAgentsBySessionKey(
        Object.fromEntries(res.data.map((a) => [a.sessionKey, a]))
      )
    } catch {
      // Ignore - console can still render without station icons
    }
  }, [])

  const fetchHistory = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/openclaw/console/sessions/${sessionId}/history`)
      const data = await res.json()

      if (data.ok && data.messages) {
        const historyMessages: ChatMessage[] = data.messages.map((m: {
          id: string
          ts: string
          role: 'operator' | 'agent' | 'system'
          summary: string
          payload?: { content?: string }
        }) => ({
          id: m.id,
          role: m.role,
          content: m.payload?.content || m.summary,
          timestamp: new Date(m.ts),
        }))
        setChatMessages(historyMessages)
      }
    } catch {
      // Silently fail - history is optional
    }
  }, [setChatMessages])

  // ============================================================================
  // EFFECTS
  // ============================================================================

  // Initial fetch and polling
  useEffect(() => {
    fetchSessions()
    fetchAgents()

    pollIntervalRef.current = setInterval(fetchSessions, POLL_INTERVAL_MS)

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [fetchSessions, fetchAgents])

  // Fetch history when session selected
  useEffect(() => {
    resetChat()
    if (!selectedSessionId) return
    fetchHistory(selectedSessionId)
  }, [selectedSessionId, fetchHistory, resetChat])

  // ============================================================================
  // HANDLERS
  // ============================================================================

  const handleSelectSession = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId)
  }, [])

  const handleSendMessage = useCallback(async (payload: PromptSubmitPayload) => {
    if (!selectedSessionId || isStreaming) return
    await sendMessage(selectedSessionId, payload)
  }, [selectedSessionId, isStreaming, sendMessage])

  const handleRefresh = useCallback(() => {
    setLoading(true)
    fetchSessions()
  }, [fetchSessions])

  const handleFilterChange = useCallback((next: SessionQueryFilters) => {
    setQueryFilters(next)
    setLoading(true)
  }, [])

  const handleSync = useCallback(async () => {
    if (syncingSessions) return
    setSyncingSessions(true)
    try {
      const res = await fetch('/api/openclaw/sessions/sync', { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.message || data?.error || 'Sync failed')
      }
      await fetchSessions()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncingSessions(false)
    }
  }, [fetchSessions, syncingSessions])

  const handleAbort = useCallback(async () => {
    if (!selectedSessionId || !isStreaming) return
    await abort(selectedSessionId, currentRunId)
  }, [abort, currentRunId, isStreaming, selectedSessionId])

  const handleEndSession = useCallback(async (session: ConsoleSessionDTO) => {
    const sessionId = session.sessionId
    const sessionKey = session.sessionKey
    setEndingSessionIds((prev) => ({ ...prev, [sessionId]: true }))
    try {
      const res = await fetch(`/api/openclaw/console/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sessionKey }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Failed to end session')
      }

      setSessions((prev) => prev.filter((s) => s.sessionKey !== sessionKey))

      const selectedSession = sessions.find((s) => s.sessionId === selectedSessionId) ?? null
      if (selectedSession?.sessionKey === sessionKey) {
        setSelectedSessionId(null)
        resetChat()
      }

      // Pull fresh state from telemetry cache after mutation.
      await fetchSessions()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to end session')
    } finally {
      setEndingSessionIds((prev) => {
        const next = { ...prev }
        delete next[sessionId]
        return next
      })
    }
  }, [fetchSessions, resetChat, selectedSessionId, sessions])

  // ============================================================================
  // RENDER
  // ============================================================================

  const selectedSession = useMemo(() => {
    if (!selectedSessionId) return null
    return sessions.find((s) => s.sessionId === selectedSessionId) ?? null
  }, [selectedSessionId, sessions])
  const combinedError = error || chatError

  return (
    <div className="flex flex-col h-full">
      {/* Error banner */}
      {combinedError && (
        <div className="mx-4 mt-4 p-3 bg-status-danger/10 border border-status-danger/20 rounded flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-status-danger flex-shrink-0" />
          <span className="text-sm text-status-danger">{combinedError}</span>
          <button
            onClick={() => {
              setError(null)
              setChatError(null)
            }}
            className="ml-auto text-xs text-fg-3 hover:text-fg-1"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {loading && sessions.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <RefreshCw className="w-6 h-6 text-fg-3 animate-spin" />
              <span className="text-sm text-fg-2">Loading sessions...</span>
            </div>
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <EmptyState
              icon={<Terminal className="w-12 h-12" />}
              title="No active sessions"
              description="Sessions appear when agents are running."
            />
          </div>
        ) : (
          <>
            {/* Session list (left sidebar) */}
            <SessionList
              sessions={sessions}
              selectedId={selectedSessionId}
              onSelect={handleSelectSession}
              gatewayStatus={gatewayStatus}
              agentsBySessionKey={agentsBySessionKey}
              onSync={handleSync}
              syncing={syncingSessions}
              onEndSession={handleEndSession}
              endingSessionIds={endingSessionIds}
              filters={queryFilters}
              onFiltersChange={handleFilterChange}
            />

            {/* Chat panel (main area) */}
            <ChatPanel
              session={selectedSession ?? null}
              messages={messages}
              onSend={handleSendMessage}
              streaming={isStreaming}
              runId={currentRunId}
              onAbort={handleAbort}
              sendDisabled={!gatewayAvailable}
              agentsBySessionKey={agentsBySessionKey}
              gatewayStatus={gatewayStatus}
              gatewayAvailable={gatewayAvailable}
              loading={loading}
              onRefresh={handleRefresh}
            />
          </>
        )}
      </div>
    </div>
  )
}
