import { NextRequest } from 'next/server'
import { subscribeReceipt, type StreamEvent } from '@/lib/pubsub'
import { getRepos } from '@/lib/repo'
import {
  checkConnectionLimit,
  incrementConnection,
  decrementConnection,
} from '@/lib/sse-limiter'

const ENDPOINT_NAME = 'receipts'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * GET /api/stream/receipts/:id
 *
 * SSE endpoint for streaming a specific receipt's output in real-time.
 * Useful for tailing running commands.
 *
 * Security: Limited to MAX_SSE_CLIENTS concurrent connections.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
) {
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

  const { id } = await context.params

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      // First, check if receipt exists and send initial state
      const repos = getRepos()
      const receipt = await repos.receipts.getById(id)

      if (!receipt) {
        controller.enqueue(
          encoder.encode(`event: error\ndata: ${JSON.stringify({ error: 'Receipt not found' })}\n\n`)
        )
        controller.close()
        return
      }

      // Send initial state with current stdout/stderr
      controller.enqueue(
        encoder.encode(`event: connected\ndata: ${JSON.stringify({
          status: 'connected',
          receipt: {
            id: receipt.id,
            commandName: receipt.commandName,
            startedAt: receipt.startedAt,
            endedAt: receipt.endedAt,
            exitCode: receipt.exitCode,
          }
        })}\n\n`)
      )

      // Send current output
      if (receipt.stdoutExcerpt) {
        controller.enqueue(
          encoder.encode(`event: stdout\ndata: ${JSON.stringify({ chunk: receipt.stdoutExcerpt })}\n\n`)
        )
      }
      if (receipt.stderrExcerpt) {
        controller.enqueue(
          encoder.encode(`event: stderr\ndata: ${JSON.stringify({ chunk: receipt.stderrExcerpt })}\n\n`)
        )
      }

      // If already finished, close
      if (receipt.endedAt) {
        controller.enqueue(
          encoder.encode(`event: finalized\ndata: ${JSON.stringify({
            exitCode: receipt.exitCode,
            durationMs: receipt.durationMs
          })}\n\n`)
        )
        controller.close()
        return
      }

      // Subscribe to live updates
      const unsubscribe = subscribeReceipt(id, (event: StreamEvent) => {
        try {
          if (event.type === 'receipt.chunk' && event.data.receiptId === id) {
            controller.enqueue(
              encoder.encode(`event: ${event.data.stream}\ndata: ${JSON.stringify({ chunk: event.data.chunk })}\n\n`)
            )
          } else if (event.type === 'receipt.finalized' && event.data.receiptId === id) {
            controller.enqueue(
              encoder.encode(`event: finalized\ndata: ${JSON.stringify(event.data)}\n\n`)
            )
            // Clean up after finalization
            unsubscribe()
            controller.close()
          }
        } catch {
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
      'X-Accel-Buffering': 'no',
    },
  })
}
