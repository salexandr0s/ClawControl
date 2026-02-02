/**
 * In-Memory Pub/Sub for SSE Streaming
 *
 * Simple EventEmitter-based pub/sub for local-first real-time updates.
 * Activities and other events are published here and streamed to connected clients.
 */

import { EventEmitter } from 'events'
import type { ActivityDTO } from './repo'

// Increase max listeners for many SSE clients
const emitter = new EventEmitter()
emitter.setMaxListeners(100)

// Event types
export type StreamEvent =
  | { type: 'activity'; data: ActivityDTO }
  | { type: 'receipt.chunk'; data: { receiptId: string; stream: 'stdout' | 'stderr'; chunk: string } }
  | { type: 'receipt.finalized'; data: { receiptId: string; exitCode: number; durationMs: number } }

// Channel names
const CHANNELS = {
  ACTIVITIES: 'activities',
  RECEIPT: (id: string) => `receipt:${id}`,
} as const

/**
 * Publish an activity to all connected clients
 */
export function publishActivity(activity: ActivityDTO): void {
  const event: StreamEvent = { type: 'activity', data: activity }
  emitter.emit(CHANNELS.ACTIVITIES, event)
}

/**
 * Publish a receipt chunk (stdout/stderr) to clients watching that receipt
 */
export function publishReceiptChunk(
  receiptId: string,
  stream: 'stdout' | 'stderr',
  chunk: string
): void {
  const event: StreamEvent = {
    type: 'receipt.chunk',
    data: { receiptId, stream, chunk },
  }
  emitter.emit(CHANNELS.RECEIPT(receiptId), event)
  // Also emit to general activities for the live view
  emitter.emit(CHANNELS.ACTIVITIES, event)
}

/**
 * Publish receipt finalization
 */
export function publishReceiptFinalized(
  receiptId: string,
  exitCode: number,
  durationMs: number
): void {
  const event: StreamEvent = {
    type: 'receipt.finalized',
    data: { receiptId, exitCode, durationMs },
  }
  emitter.emit(CHANNELS.RECEIPT(receiptId), event)
  emitter.emit(CHANNELS.ACTIVITIES, event)
}

/**
 * Subscribe to the activities stream
 */
export function subscribeActivities(
  callback: (event: StreamEvent) => void
): () => void {
  emitter.on(CHANNELS.ACTIVITIES, callback)
  return () => emitter.off(CHANNELS.ACTIVITIES, callback)
}

/**
 * Subscribe to a specific receipt's stream
 */
export function subscribeReceipt(
  receiptId: string,
  callback: (event: StreamEvent) => void
): () => void {
  const channel = CHANNELS.RECEIPT(receiptId)
  emitter.on(channel, callback)
  return () => emitter.off(channel, callback)
}

/**
 * Get current subscriber count for monitoring
 */
export function getSubscriberCount(): { activities: number } {
  return {
    activities: emitter.listenerCount(CHANNELS.ACTIVITIES),
  }
}
