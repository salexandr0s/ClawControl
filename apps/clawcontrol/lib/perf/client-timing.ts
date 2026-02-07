'use client'

import { useEffect, useRef } from 'react'

type PerfEventKind = 'fetch' | 'page-ready' | 'stage'

export interface ClientPerfEvent {
  kind: PerfEventKind
  page: string
  name: string
  durationMs: number
  startedAtMs: number
  endedAtMs: number
  status?: number
  ok?: boolean
  error?: string
  at: string
}

declare global {
  interface Window {
    __clawcontrolPerfEvents?: ClientPerfEvent[]
  }
}

const MAX_EVENTS = 1_500

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

function isBrowser(): boolean {
  return typeof window !== 'undefined'
}

function truncateError(input: unknown): string {
  const raw = input instanceof Error ? input.message : String(input)
  return raw.length <= 220 ? raw : `${raw.slice(0, 220)}...`
}

export function recordClientPerfEvent(event: Omit<ClientPerfEvent, 'at'>): void {
  if (!isBrowser()) return

  const next: ClientPerfEvent = {
    ...event,
    at: new Date().toISOString(),
  }

  const store = window.__clawcontrolPerfEvents ?? []
  store.push(next)

  if (store.length > MAX_EVENTS) {
    store.splice(0, store.length - MAX_EVENTS)
  }

  window.__clawcontrolPerfEvents = store

  if (process.env.NEXT_PUBLIC_CLAWCONTROL_PERF_LOG === '1') {
    const status = typeof next.status === 'number' ? ` status=${next.status}` : ''
    const suffix = next.error ? ` error=${next.error}` : ''
    console.log(`[perf][client] ${next.page}:${next.name} ${next.durationMs.toFixed(1)}ms${status}${suffix}`)
  }
}

export async function timedClientFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  meta: {
    page: string
    name: string
  }
): Promise<Response> {
  const startedAtMs = nowMs()

  try {
    const response = await fetch(input, init)
    const endedAtMs = nowMs()

    recordClientPerfEvent({
      kind: 'fetch',
      page: meta.page,
      name: meta.name,
      durationMs: Math.max(0, endedAtMs - startedAtMs),
      startedAtMs,
      endedAtMs,
      status: response.status,
      ok: response.ok,
    })

    return response
  } catch (error) {
    const endedAtMs = nowMs()
    recordClientPerfEvent({
      kind: 'fetch',
      page: meta.page,
      name: meta.name,
      durationMs: Math.max(0, endedAtMs - startedAtMs),
      startedAtMs,
      endedAtMs,
      ok: false,
      error: truncateError(error),
    })
    throw error
  }
}

export function usePageReadyTiming(page: string, ready: boolean, stageName = 'interactive'): void {
  const startedAtRef = useRef<number | null>(null)
  const emittedRef = useRef(false)

  useEffect(() => {
    startedAtRef.current = nowMs()
    emittedRef.current = false
  }, [page])

  useEffect(() => {
    if (!ready || emittedRef.current) return

    const startedAtMs = startedAtRef.current ?? nowMs()
    const endedAtMs = nowMs()

    emittedRef.current = true

    recordClientPerfEvent({
      kind: 'page-ready',
      page,
      name: stageName,
      durationMs: Math.max(0, endedAtMs - startedAtMs),
      startedAtMs,
      endedAtMs,
      ok: true,
    })
  }, [page, ready, stageName])
}

export function recordPageStage(page: string, name: string, startedAtMs: number): void {
  const endedAtMs = nowMs()
  recordClientPerfEvent({
    kind: 'stage',
    page,
    name,
    durationMs: Math.max(0, endedAtMs - startedAtMs),
    startedAtMs,
    endedAtMs,
    ok: true,
  })
}
