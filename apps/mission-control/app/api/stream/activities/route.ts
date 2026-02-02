import { NextRequest } from 'next/server'
import { subscribeActivities, type StreamEvent } from '@/lib/pubsub'
import { getRepos } from '@/lib/repo'
import {
  checkConnectionLimit,
  incrementConnection,
  decrementConnection,
} from '@/lib/sse-limiter'

const ENDPOINT_NAME = 'activities'

/**
 * GET /api/stream/activities
 *
 * SSE endpoint for real-time activity streaming.
 * Supports filters: type, entityType, entityId, sinceId
 *
 * Security: Limited to MAX_SSE_CLIENTS concurrent connections.
 */
export async function GET(request: NextRequest) {
  // Check connection limit (DoS prevention)
  if (!checkConnectionLimit(ENDPOINT_NAME)) {
    return new Response('Too many connections', {
      status: 429,
      headers: { 'Retry-After': '5' },
    })
  }

  // Track this connection
  incrementConnection(ENDPOINT_NAME)

  // Ensure cleanup on disconnect
  request.signal.addEventListener('abort', () => {
    decrementConnection(ENDPOINT_NAME)
  })

  const searchParams = request.nextUrl.searchParams

  // Parse filters
  const typeFilter = searchParams.get('type') // e.g., "work_order" to match work_order.*
  const entityType = searchParams.get('entityType')
  const entityId = searchParams.get('entityId')
  const sinceId = searchParams.get('sinceId')

  // Create a readable stream for SSE
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial connection message
      controller.enqueue(
        encoder.encode(`event: connected\ndata: ${JSON.stringify({ status: 'connected' })}\n\n`)
      )

      // If sinceId provided, send missed activities first
      if (sinceId) {
        try {
          const repos = getRepos()
          const recentActivities = await repos.activities.listRecent(100)
          const sinceIndex = recentActivities.findIndex((a) => a.id === sinceId)

          if (sinceIndex > 0) {
            // Send activities that came after sinceId (they're in reverse order)
            const missedActivities = recentActivities.slice(0, sinceIndex).reverse()
            for (const activity of missedActivities) {
              if (shouldInclude(activity, typeFilter, entityType, entityId)) {
                const event: StreamEvent = { type: 'activity', data: activity }
                controller.enqueue(
                  encoder.encode(`event: activity\ndata: ${JSON.stringify(event)}\n\n`)
                )
              }
            }
          }
        } catch (error) {
          console.error('[SSE] Error fetching missed activities:', error)
        }
      }

      // Subscribe to new activities
      const unsubscribe = subscribeActivities((event) => {
        try {
          // Apply filters
          if (event.type === 'activity') {
            if (!shouldInclude(event.data, typeFilter, entityType, entityId)) {
              return
            }
          }

          // Send the event
          controller.enqueue(
            encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
          )
        } catch {
          // Client disconnected
          unsubscribe()
        }
      })

      // Send keepalive every 30 seconds
      const keepaliveInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`))
        } catch {
          clearInterval(keepaliveInterval)
          unsubscribe()
        }
      }, 30000)

      // Cleanup on close
      request.signal.addEventListener('abort', () => {
        clearInterval(keepaliveInterval)
        unsubscribe()
        controller.close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  })
}

function shouldInclude(
  activity: { type: string; entityType: string; entityId: string },
  typeFilter: string | null,
  entityType: string | null,
  entityId: string | null
): boolean {
  if (typeFilter && !activity.type.startsWith(typeFilter)) {
    return false
  }
  if (entityType && activity.entityType !== entityType) {
    return false
  }
  if (entityId && activity.entityId !== entityId) {
    return false
  }
  return true
}
