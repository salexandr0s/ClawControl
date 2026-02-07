import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/db'
import { getRepos } from '@/lib/repo'
import {
  getWsConsoleClient,
  checkGatewayAvailability,
  type ChatEvent,
} from '@/lib/openclaw/console-client'
import { getRequestActor } from '@/lib/request-actor'

// ============================================================================
// TYPES
// ============================================================================

interface ChatRequestBody {
  text?: string
  attachments?: ChatAttachmentInput[]
}

interface ChatAttachmentInput {
  type?: unknown
  mimeType?: unknown
  fileName?: unknown
  content?: unknown
}

interface NormalizedChatAttachment {
  type: string
  mimeType: string
  fileName: string
  content: string
}

// ============================================================================
// POST /api/openclaw/console/sessions/[id]/chat
// ============================================================================

/**
 * Send a message to an OpenClaw SESSION (true session messaging).
 *
 * IMPORTANT: This uses the gateway's WebSocket chat.send method, which
 * routes by sessionKey and injects into the existing session's context.
 * This is TRUE session injection, not just agent messaging.
 *
 * Creates Activity + Receipt for audit trail.
 * Returns SSE stream with response chunks from the agent.
 *
 * Request body:
 * - text: Message text (optional when attachments are present, max 10000 chars)
 * - attachments: Optional image attachments (base64/data URL)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params
  const { actor } = getRequestActor(request)

  // Parse and validate request body
  let body: ChatRequestBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body', code: 'INVALID_BODY' },
      { status: 400 }
    )
  }

  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const attachments = normalizeAttachments(body.attachments)

  if (!text && attachments.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'Message text or attachment is required', code: 'MISSING_TEXT' },
      { status: 400 }
    )
  }

  if (text.length > 10000) {
    return NextResponse.json(
      { ok: false, error: 'Message must be <= 10000 characters', code: 'INVALID_TEXT_LENGTH' },
      { status: 400 }
    )
  }

  // Verify session exists
  const session = await prisma.agentSession.findUnique({
    where: { sessionId },
  })

  if (!session) {
    return NextResponse.json(
      { ok: false, error: 'Session not found', code: 'SESSION_NOT_FOUND' },
      { status: 404 }
    )
  }

  // Check gateway availability (fail-closed for writes)
  const availability = await checkGatewayAvailability()
  if (!availability.available) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Gateway unavailable — cannot send',
        code: 'GATEWAY_UNAVAILABLE',
        details: { latencyMs: availability.latencyMs, gatewayError: availability.error },
      },
      { status: 503 }
    )
  }

  const repos = getRepos()
  const startTime = Date.now()
  const idempotencyKey = randomUUID()
  const messagePreview = text.slice(0, 2000)

  // Create receipt for tracking
  const receipt = await repos.receipts.create({
    workOrderId: session.workOrderId ?? 'console',
    operationId: session.operationId,
    kind: 'manual',
    commandName: 'console.session.chat',
    commandArgs: {
      sessionId,
      sessionKey: session.sessionKey,
      agentId: session.agentId,
      messagePreview: messagePreview.slice(0, 100),
      attachmentCount: attachments.length,
      mode: 'session_chat', // TRUE session injection
      idempotencyKey,
    },
  })

  // Create activity for audit trail
  await repos.activities.create({
    type: 'openclaw.session.chat',
    actor: actor || 'operator:unknown',
    entityType: 'session', // Target is session
    entityId: session.sessionKey,
    summary: `Messaged session ${session.sessionKey} (${session.agentId})`,
    payloadJson: {
      receiptId: receipt.id,
      agentId: session.agentId,
      sessionId,
      sessionKey: session.sessionKey,
      messageLength: text.length,
      messagePreview,
      attachmentCount: attachments.length,
      mode: 'session_chat',
      idempotencyKey,
    },
  })

  // Get WebSocket client
  const client = getWsConsoleClient()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let fullResponse = ''
      let runId: string | null = null

      // Emit metadata event first
      const metaEvent = JSON.stringify({
        mode: 'session_chat',
        targetSessionKey: session.sessionKey,
        targetAgentId: session.agentId,
        note: 'Routes by sessionKey via WS chat.send. TRUE session injection.',
      })
      controller.enqueue(encoder.encode(`data: ${metaEvent}\n\n`))

      try {
        // Send message via WebSocket
        const sendResult = await client.chatSend({
          sessionKey: session.sessionKey,
          message: text,
          attachments,
          idempotencyKey,
        })

        runId = sendResult.runId

        // Emit run started event
        const startEvent = JSON.stringify({
          runId,
          status: sendResult.status,
        })
        controller.enqueue(encoder.encode(`data: ${startEvent}\n\n`))

        // Subscribe to chat events for this run
        const eventPromise = new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            unsubscribe()
            reject(new Error('Response timeout'))
          }, 120000) // 2 minute timeout

          const unsubscribe = client.streamChatEvents(runId!, (event: ChatEvent) => {
            // Handle delta events (streaming chunks)
            if (event.state === 'delta' && event.message) {
              const content = extractTextContent(event.message)
              if (content) {
                fullResponse += content
                const chunkEvent = JSON.stringify({ chunk: content })
                controller.enqueue(encoder.encode(`data: ${chunkEvent}\n\n`))

                // Append to receipt
                repos.receipts.append(receipt.id, {
                  stream: 'stdout',
                  chunk: content,
                }).catch(() => {})
              }
            }

            // Handle final event
            if (event.state === 'final') {
              clearTimeout(timeout)
              unsubscribe()

              // Extract final message if present
              if (event.message) {
                const content = extractTextContent(event.message)
                if (content && !fullResponse.includes(content)) {
                  fullResponse = content
                }
              }

              resolve()
            }

            // Handle error event
            if (event.state === 'error') {
              clearTimeout(timeout)
              unsubscribe()
              reject(new Error(event.errorMessage ?? 'Chat error'))
            }

            // Handle aborted event
            if (event.state === 'aborted') {
              clearTimeout(timeout)
              unsubscribe()
              resolve()
            }
          })
        })

        await eventPromise

        // Finalize receipt with success
        const durationMs = Date.now() - startTime
        await repos.receipts.finalize(receipt.id, {
          exitCode: 0,
          durationMs,
          parsedJson: {
            runId,
            response: fullResponse,
            responseLength: fullResponse.length,
          },
        })

        // Create completion activity
        await repos.activities.create({
          type: 'openclaw.session.chat.response',
          actor: `agent:${session.agentId}`,
          entityType: 'session',
          entityId: session.sessionKey,
          summary: `Response from ${session.agentId} (${fullResponse.length} chars)`,
          payloadJson: {
            receiptId: receipt.id,
            runId,
            sessionKey: session.sessionKey,
            responseLength: fullResponse.length,
            responsePreview: fullResponse.slice(0, 2000),
            durationMs,
            mode: 'session_chat',
          },
        })

        // Send done event
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error'

        // Finalize receipt with error
        const durationMs = Date.now() - startTime
        await repos.receipts.finalize(receipt.id, {
          exitCode: 1,
          durationMs,
          parsedJson: {
            runId,
            error: errorMessage,
            partialResponse: fullResponse,
          },
        })

        // Send error event
        const errorEvent = JSON.stringify({ error: errorMessage })
        controller.enqueue(encoder.encode(`data: ${errorEvent}\n\n`))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      }
    },
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Receipt-Id': receipt.id,
    },
  })
}

// ============================================================================
// Helpers
// ============================================================================

function extractTextContent(message: unknown): string | null {
  if (!message || typeof message !== 'object') {
    return null
  }

  const msg = message as Record<string, unknown>

  // Handle content array format
  if (Array.isArray(msg.content)) {
    for (const item of msg.content) {
      if (item && typeof item === 'object' && 'type' in item && item.type === 'text' && 'text' in item) {
        return String(item.text)
      }
    }
  }

  // Handle string content
  if (typeof msg.content === 'string') {
    return msg.content
  }

  return null
}

function normalizeAttachments(input: ChatAttachmentInput[] | undefined): NormalizedChatAttachment[] {
  if (!Array.isArray(input)) return []

  const normalized: NormalizedChatAttachment[] = []
  for (const raw of input) {
    const content = typeof raw?.content === 'string' ? raw.content.trim() : ''
    if (!content) continue

    const mimeType = typeof raw?.mimeType === 'string' && raw.mimeType.trim().length > 0
      ? raw.mimeType.trim()
      : 'image/png'
    const type = typeof raw?.type === 'string' && raw.type.trim().length > 0
      ? raw.type.trim()
      : 'image'
    const fileName = typeof raw?.fileName === 'string' && raw.fileName.trim().length > 0
      ? raw.fileName.trim()
      : 'attachment'

    normalized.push({
      type,
      mimeType,
      fileName,
      content,
    })
  }

  // Keep a hard cap to prevent oversized payload abuse.
  return normalized.slice(0, 8)
}
