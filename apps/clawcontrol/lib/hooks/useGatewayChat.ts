'use client'

import { useCallback } from 'react'
import { useChatStore, type ChatAttachment } from '@/lib/stores/chat-store'
import { apiRequest } from '@/lib/http'

type SseJson =
  | { chunk: string }
  | { replace: string }
  | { runId: string; status?: string }
  | { error: string }
  | Record<string, unknown>

function parseSseDataBlocks(buffer: string): { events: string[]; rest: string } {
  const events: string[] = []
  let rest = buffer

  while (true) {
    const idx = rest.indexOf('\n\n')
    if (idx === -1) break
    const raw = rest.slice(0, idx)
    rest = rest.slice(idx + 2)
    events.push(raw)
  }

  return { events, rest }
}

function extractData(eventBlock: string): string[] {
  const lines = eventBlock.split('\n')
  const data: string[] = []
  for (const line of lines) {
    const trimmed = line.trimEnd()
    if (!trimmed.startsWith('data:')) continue
    data.push(trimmed.slice('data:'.length).trimStart())
  }
  return data
}

async function safeReadJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

export function useGatewayChat() {
  const {
    addMessage,
    patchMessage,
    setStreaming,
    setLoading,
    setError,
    setRunId,
    isStreaming,
  } = useChatStore()

  const sendMessage = useCallback(
    async (sessionId: string, payload: { text: string; attachments?: ChatAttachment[] }) => {
      if (!sessionId) return
      if (isStreaming) return

      const content = payload.text.trim()
      const attachments = payload.attachments ?? []
      if (!content && attachments.length === 0) return

      setError(null)
      setStreaming(true)
      setLoading(true)
      setRunId(null)

      const operatorMessageId = `msg_${Date.now()}_operator`
      const agentMessageId = `msg_${Date.now()}_agent`

      addMessage({
        id: operatorMessageId,
        role: 'operator',
        content: content || `Sent ${attachments.length} attachment${attachments.length === 1 ? '' : 's'}`,
        attachments,
        timestamp: new Date(),
        pending: true,
      })

      addMessage({
        id: agentMessageId,
        role: 'agent',
        content: '',
        timestamp: new Date(),
        streaming: true,
      })

      let agentResponse = ''

      try {
        const res = await apiRequest(`/api/openclaw/console/sessions/${sessionId}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: content,
            attachments: attachments.length > 0 ? attachments : undefined,
          }),
        })

        if (!res.ok) {
          const body = await safeReadJson(res)
          const errorMessage =
            body && typeof body === 'object' && body !== null && 'error' in body
              ? String((body as { error?: unknown }).error)
              : `Request failed (${res.status})`
          throw new Error(errorMessage)
        }

        const reader = res.body?.getReader()
        if (!reader) throw new Error('No response stream')

        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })

          const { events, rest } = parseSseDataBlocks(buffer)
          buffer = rest

          for (const eventBlock of events) {
            const dataLines = extractData(eventBlock)
            if (dataLines.length === 0) continue

            const data = dataLines.join('\n')
            if (data === '[DONE]') {
              continue
            }

            let parsed: SseJson
            try {
              parsed = JSON.parse(data) as SseJson
            } catch {
              continue
            }

            if (parsed && typeof parsed === 'object') {
              if ('runId' in parsed && typeof parsed.runId === 'string') {
                setRunId(parsed.runId)
              }

              if ('chunk' in parsed && typeof parsed.chunk === 'string') {
                agentResponse += parsed.chunk
                patchMessage(agentMessageId, {
                  content: agentResponse,
                  streaming: true,
                })
              }

              if ('replace' in parsed && typeof parsed.replace === 'string') {
                agentResponse = parsed.replace
                patchMessage(agentMessageId, {
                  content: agentResponse,
                  streaming: true,
                })
              }

              if ('error' in parsed && typeof parsed.error === 'string') {
                throw new Error(parsed.error)
              }
            }
          }
        }

        patchMessage(operatorMessageId, { pending: false })
        patchMessage(agentMessageId, { streaming: false })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Send failed'

        patchMessage(operatorMessageId, { pending: false, error: message })
        patchMessage(agentMessageId, { streaming: false, error: message })
        setError(message)
      } finally {
        setStreaming(false)
        setLoading(false)
        setRunId(null)
      }
    },
    [
      addMessage,
      isStreaming,
      patchMessage,
      setError,
      setLoading,
      setRunId,
      setStreaming,
    ]
  )

  const abort = useCallback(async (sessionId: string, runId: string | null) => {
    if (!sessionId) return

    try {
      const res = await apiRequest(`/api/openclaw/console/sessions/${sessionId}/abort`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId }),
      })

      if (!res.ok) {
        const body = await safeReadJson(res)
        const errorMessage =
          body && typeof body === 'object' && body !== null && 'error' in body
            ? String((body as { error?: unknown }).error)
            : `Abort failed (${res.status})`
        throw new Error(errorMessage)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Abort failed'
      setError(message)
    }
  }, [setError])

  return { sendMessage, abort }
}
