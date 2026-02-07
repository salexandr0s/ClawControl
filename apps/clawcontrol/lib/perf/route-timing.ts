import { NextResponse } from 'next/server'

type RouteHandler = (...args: any[]) => Promise<Response> | Response

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

function ensureMutableHeaders(response: Response): { response: Response; headers: Headers } {
  try {
    response.headers.set('x-clawcontrol-perf-probe', '1')
    response.headers.delete('x-clawcontrol-perf-probe')
    return { response, headers: response.headers }
  } catch {
    const headers = new Headers(response.headers)
    const cloned = new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
    return { response: cloned, headers: cloned.headers }
  }
}

function appendServerTiming(existing: string | null, routeId: string, durationMs: number): string {
  const entry = `${routeId};dur=${durationMs.toFixed(1)}`
  if (!existing || existing.trim().length === 0) return entry
  return `${existing}, ${entry}`
}

export function withRouteTiming<T extends RouteHandler>(routeId: string, handler: T): T {
  return (async (...args: Parameters<T>) => {
    const startedAt = nowMs()

    try {
      const response = await handler(...args)
      const latencyMs = Math.max(0, nowMs() - startedAt)
      const { response: timedResponse, headers } = ensureMutableHeaders(response)

      headers.set('x-clawcontrol-latency-ms', latencyMs.toFixed(1))
      headers.set('x-clawcontrol-route', routeId)
      headers.set(
        'server-timing',
        appendServerTiming(headers.get('server-timing'), routeId, latencyMs)
      )

      if (process.env.CLAWCONTROL_PERF_LOG === '1') {
        console.log(`[perf][api] ${routeId} ${latencyMs.toFixed(1)}ms status=${timedResponse.status}`)
      }

      return timedResponse
    } catch (error) {
      const latencyMs = Math.max(0, nowMs() - startedAt)
      if (process.env.CLAWCONTROL_PERF_LOG === '1') {
        console.warn(`[perf][api] ${routeId} ${latencyMs.toFixed(1)}ms status=error`)
      }
      throw error
    }
  }) as T
}
