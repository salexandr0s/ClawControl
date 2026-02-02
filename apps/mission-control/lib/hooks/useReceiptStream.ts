'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { SseConnectionState } from './useSseStream'

export interface ReceiptStreamMetadata {
  id: string
  commandName: string
  startedAt: Date
  endedAt: Date | null
}

export interface UseReceiptStreamOptions {
  /** Receipt ID to stream */
  receiptId: string
  /** Callback when a new chunk arrives */
  onChunk?: (stream: 'stdout' | 'stderr', chunk: string) => void
  /** Callback when receipt is finalized */
  onFinalized?: (exitCode: number, durationMs: number) => void
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean
  /** Reconnect delay in ms (default: 3000) */
  reconnectDelay?: number
  /** Max reconnect attempts (default: 5) */
  maxReconnectAttempts?: number
}

export interface UseReceiptStreamReturn {
  /** Accumulated stdout content */
  stdout: string
  /** Accumulated stderr content */
  stderr: string
  /** Whether the receipt has been finalized */
  isFinalized: boolean
  /** Exit code (null if still running) */
  exitCode: number | null
  /** Duration in ms (null if still running) */
  durationMs: number | null
  /** Receipt metadata */
  metadata: ReceiptStreamMetadata | null
  /** Current connection state */
  connectionState: SseConnectionState
  /** Manually reconnect */
  reconnect: () => void
  /** Disconnect the stream */
  disconnect: () => void
}

export function useReceiptStream(options: UseReceiptStreamOptions): UseReceiptStreamReturn {
  const {
    receiptId,
    onChunk,
    onFinalized,
    autoReconnect = true,
    reconnectDelay = 3000,
    maxReconnectAttempts = 5,
  } = options

  const [stdout, setStdout] = useState('')
  const [stderr, setStderr] = useState('')
  const [isFinalized, setIsFinalized] = useState(false)
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [durationMs, setDurationMs] = useState<number | null>(null)
  const [metadata, setMetadata] = useState<ReceiptStreamMetadata | null>(null)
  const [connectionState, setConnectionState] = useState<SseConnectionState>('disconnected')

  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    setConnectionState('disconnected')
  }, [])

  const connect = useCallback(() => {
    if (!receiptId) return

    const url = `/api/stream/receipts/${receiptId}`

    setConnectionState('connecting')

    const eventSource = new EventSource(url)
    eventSourceRef.current = eventSource

    eventSource.onopen = () => {
      reconnectAttemptsRef.current = 0
      setConnectionState('connected')
    }

    // Handle initial connected event with metadata
    eventSource.addEventListener('connected', (event) => {
      try {
        const parsed = JSON.parse(event.data)
        if (parsed.status === 'connected' && parsed.receipt) {
          setMetadata({
            id: parsed.receipt.id,
            commandName: parsed.receipt.commandName,
            startedAt: new Date(parsed.receipt.startedAt),
            endedAt: parsed.receipt.endedAt ? new Date(parsed.receipt.endedAt) : null,
          })
          // If receipt has existing output, set it
          if (parsed.receipt.stdoutExcerpt) {
            setStdout(parsed.receipt.stdoutExcerpt)
          }
          if (parsed.receipt.stderrExcerpt) {
            setStderr(parsed.receipt.stderrExcerpt)
          }
          // If already finalized
          if (parsed.receipt.exitCode !== null && parsed.receipt.exitCode !== undefined) {
            setIsFinalized(true)
            setExitCode(parsed.receipt.exitCode)
            setDurationMs(parsed.receipt.durationMs)
          }
        }
        setConnectionState('connected')
      } catch (error) {
        console.error('[ReceiptStream] Failed to parse connected event:', error)
      }
    })

    // Handle stdout chunks
    eventSource.addEventListener('stdout', (event) => {
      try {
        const parsed = JSON.parse(event.data)
        if (parsed.chunk) {
          setStdout((prev) => prev + parsed.chunk)
          onChunk?.('stdout', parsed.chunk)
        }
      } catch (error) {
        console.error('[ReceiptStream] Failed to parse stdout event:', error)
      }
    })

    // Handle stderr chunks
    eventSource.addEventListener('stderr', (event) => {
      try {
        const parsed = JSON.parse(event.data)
        if (parsed.chunk) {
          setStderr((prev) => prev + parsed.chunk)
          onChunk?.('stderr', parsed.chunk)
        }
      } catch (error) {
        console.error('[ReceiptStream] Failed to parse stderr event:', error)
      }
    })

    // Handle finalized event
    eventSource.addEventListener('finalized', (event) => {
      try {
        const parsed = JSON.parse(event.data)
        setIsFinalized(true)
        setExitCode(parsed.exitCode ?? null)
        setDurationMs(parsed.durationMs ?? null)
        onFinalized?.(parsed.exitCode, parsed.durationMs)

        // Close connection after finalization
        eventSource.close()
        eventSourceRef.current = null
        setConnectionState('disconnected')
      } catch (error) {
        console.error('[ReceiptStream] Failed to parse finalized event:', error)
      }
    })

    // Handle errors event (receipt not found, etc.)
    eventSource.addEventListener('error', (event) => {
      try {
        // Check if this is a custom error event with data
        const messageEvent = event as MessageEvent
        if (messageEvent.data) {
          const parsed = JSON.parse(messageEvent.data)
          console.error('[ReceiptStream] Server error:', parsed.error)
        }
      } catch {
        // Ignore parse errors for connection errors
      }
    })

    eventSource.onerror = () => {
      eventSource.close()
      eventSourceRef.current = null
      setConnectionState('error')

      // Don't reconnect if finalized or if this was expected
      if (isFinalized) return

      // Auto-reconnect
      if (autoReconnect && reconnectAttemptsRef.current < maxReconnectAttempts) {
        reconnectAttemptsRef.current += 1
        const delay = reconnectDelay * Math.min(reconnectAttemptsRef.current, 3)
        reconnectTimeoutRef.current = setTimeout(() => {
          connect()
        }, delay)
      } else {
        setConnectionState('disconnected')
      }
    }
  }, [
    receiptId,
    onChunk,
    onFinalized,
    autoReconnect,
    reconnectDelay,
    maxReconnectAttempts,
    isFinalized,
  ])

  const reconnect = useCallback(() => {
    disconnect()
    reconnectAttemptsRef.current = 0
    // Reset state for fresh connection
    setStdout('')
    setStderr('')
    setIsFinalized(false)
    setExitCode(null)
    setDurationMs(null)
    setMetadata(null)
    connect()
  }, [disconnect, connect])

  // Connect on mount or when receiptId changes
  useEffect(() => {
    if (receiptId) {
      connect()
    }
    return () => {
      disconnect()
    }
  }, [receiptId])

  return {
    stdout,
    stderr,
    isFinalized,
    exitCode,
    durationMs,
    metadata,
    connectionState,
    reconnect,
    disconnect,
  }
}
