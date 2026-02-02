'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { ActivityDTO } from '@/lib/repo'

export type SseConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface SseStreamOptions {
  /** Filter by activity type prefix (e.g., "work_order" matches work_order.*) */
  type?: string
  /** Filter by entity type */
  entityType?: string
  /** Filter by entity ID */
  entityId?: string
  /** Resume from this activity ID */
  sinceId?: string
  /** Callback when a new activity arrives */
  onActivity?: (activity: ActivityDTO) => void
  /** Callback when connection state changes */
  onConnectionChange?: (state: SseConnectionState) => void
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean
  /** Reconnect delay in ms (default: 3000) */
  reconnectDelay?: number
  /** Max reconnect attempts (default: 10) */
  maxReconnectAttempts?: number
}

interface UseSseStreamReturn {
  /** Current connection state */
  connectionState: SseConnectionState
  /** Last activity ID received (for resuming) */
  lastActivityId: string | null
  /** Manually reconnect */
  reconnect: () => void
  /** Disconnect the stream */
  disconnect: () => void
}

export function useSseStream(options: SseStreamOptions = {}): UseSseStreamReturn {
  const {
    type,
    entityType,
    entityId,
    sinceId,
    onActivity,
    onConnectionChange,
    autoReconnect = true,
    reconnectDelay = 3000,
    maxReconnectAttempts = 10,
  } = options

  const [connectionState, setConnectionState] = useState<SseConnectionState>('disconnected')
  const [lastActivityId, setLastActivityId] = useState<string | null>(sinceId ?? null)

  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const updateConnectionState = useCallback(
    (state: SseConnectionState) => {
      setConnectionState(state)
      onConnectionChange?.(state)
    },
    [onConnectionChange]
  )

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    updateConnectionState('disconnected')
  }, [updateConnectionState])

  const connect = useCallback(() => {
    // Build URL with filters
    const params = new URLSearchParams()
    if (type) params.set('type', type)
    if (entityType) params.set('entityType', entityType)
    if (entityId) params.set('entityId', entityId)
    if (lastActivityId) params.set('sinceId', lastActivityId)

    const url = `/api/stream/activities${params.toString() ? `?${params.toString()}` : ''}`

    updateConnectionState('connecting')

    const eventSource = new EventSource(url)
    eventSourceRef.current = eventSource

    eventSource.onopen = () => {
      reconnectAttemptsRef.current = 0
      updateConnectionState('connected')
    }

    eventSource.addEventListener('connected', () => {
      updateConnectionState('connected')
    })

    eventSource.addEventListener('activity', (event) => {
      try {
        const parsed = JSON.parse(event.data)
        if (parsed.type === 'activity' && parsed.data) {
          const activity: ActivityDTO = {
            ...parsed.data,
            ts: new Date(parsed.data.ts),
          }
          setLastActivityId(activity.id)
          onActivity?.(activity)
        }
      } catch (error) {
        console.error('[SSE] Failed to parse activity event:', error)
      }
    })

    eventSource.onerror = () => {
      eventSource.close()
      eventSourceRef.current = null
      updateConnectionState('error')

      // Auto-reconnect
      if (autoReconnect && reconnectAttemptsRef.current < maxReconnectAttempts) {
        reconnectAttemptsRef.current += 1
        const delay = reconnectDelay * Math.min(reconnectAttemptsRef.current, 5)
        reconnectTimeoutRef.current = setTimeout(() => {
          connect()
        }, delay)
      } else {
        updateConnectionState('disconnected')
      }
    }
  }, [
    type,
    entityType,
    entityId,
    lastActivityId,
    onActivity,
    autoReconnect,
    reconnectDelay,
    maxReconnectAttempts,
    updateConnectionState,
  ])

  const reconnect = useCallback(() => {
    disconnect()
    reconnectAttemptsRef.current = 0
    connect()
  }, [disconnect, connect])

  // Connect on mount
  useEffect(() => {
    connect()
    return () => {
      disconnect()
    }
  }, [])

  return {
    connectionState,
    lastActivityId,
    reconnect,
    disconnect,
  }
}
