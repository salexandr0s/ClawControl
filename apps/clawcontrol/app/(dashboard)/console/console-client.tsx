'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { PageHeader, EmptyState } from '@clawcontrol/ui'
import { Terminal, Wifi, WifiOff, AlertCircle, RefreshCw } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useProtectedActionTrigger } from '@/components/protected-action-modal'
import { agentsApi } from '@/lib/http'
import { useGatewayChat } from '@/lib/hooks/useGatewayChat'
import { useChatStore, type ChatMessage } from '@/lib/stores/chat-store'
import { SessionList } from './components/session-list'
import { ChatPanel } from './components/chat-panel'
import { cn } from '@/lib/utils'
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
    if (prev.state !== next.state) return false
    if (prev.percentUsed !== next.percentUsed) return false
    if (prev.abortedLastRun !== next.abortedLastRun) return false
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

  // Refs for retry logic
  const retryCountRef = useRef(0)
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const triggerProtectedAction = useProtectedActionTrigger()
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
      const res = await fetch('/api/openclaw/console/sessions')
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
  }, [])

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

  const handleSendMessage = useCallback(async (content: string) => {
    if (!selectedSessionId || isStreaming) return

    triggerProtectedAction({
      actionKind: 'console.session.chat',
      actionTitle: 'Send to Session',
      actionDescription: `Send message to session (true session injection)`,
      onConfirm: async (typedConfirmText) => {
        await sendMessage(selectedSessionId, content, typedConfirmText)
      },
      onError: (err) => {
        setError(err.message)
      },
    })
  }, [selectedSessionId, isStreaming, triggerProtectedAction, sendMessage])

  const handleRefresh = useCallback(() => {
    setLoading(true)
    fetchSessions()
  }, [fetchSessions])

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
      {/* Header */}
      <PageHeader
        title="Console"
        actions={
          <div className="flex items-center gap-3">
            {/* Gateway status indicator */}
            <div className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded text-xs',
              gatewayStatus === 'ok' && 'bg-status-success/10 text-status-success',
              gatewayStatus === 'degraded' && 'bg-status-warning/10 text-status-warning',
              gatewayStatus === 'unavailable' && 'bg-status-danger/10 text-status-danger',
            )}>
              {gatewayAvailable ? (
                <Wifi className="w-3.5 h-3.5" />
              ) : (
                <WifiOff className="w-3.5 h-3.5" />
              )}
              <span className="font-medium">
                {gatewayStatus === 'ok' && 'Connected'}
                {gatewayStatus === 'degraded' && 'Degraded'}
                {gatewayStatus === 'unavailable' && 'Unavailable'}
              </span>
            </div>

            {/* Refresh button */}
            <button
              onClick={handleRefresh}
              disabled={loading}
              className={cn(
                'p-2 rounded hover:bg-bg-3/50 transition-colors',
                loading && 'opacity-50 cursor-not-allowed'
              )}
            >
              <RefreshCw className={cn('w-4 h-4 text-fg-2', loading && 'animate-spin')} />
            </button>
          </div>
        }
      />

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
            />
          </>
        )}
      </div>
    </div>
  )
}
