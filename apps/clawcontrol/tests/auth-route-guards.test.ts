import { describe, expect, it } from 'vitest'

describe('auth route guards', () => {
  it('rejects work-order start without operator session', async () => {
    const route = await import('@/app/api/work-orders/[id]/start/route')
    const request = new Request('http://localhost/api/work-orders/wo_1/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    const response = await route.POST(request, {
      params: Promise.resolve({ id: 'wo_1' }),
    })
    const payload = (await response.json()) as { code?: string }

    expect(response.status).toBe(401)
    expect(payload.code).toBe('AUTH_REQUIRED')
  })

  it('rejects agent completion without internal token', async () => {
    const route = await import('@/app/api/agents/completion/route')
    const request = new Request('http://localhost/api/agents/completion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operationId: 'op_1',
        status: 'completed',
      }),
    })

    const response = await route.POST(request)
    const payload = (await response.json()) as { code?: string }

    expect(response.status).toBe(403)
    expect(payload.code).toBe('INTERNAL_TOKEN_REQUIRED')
  })

  it('rejects internal ops actionable ingest without internal token', async () => {
    const route = await import('@/app/api/internal/ops/actionable/route')
    const request = new Request('http://localhost/api/internal/ops/actionable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'cron',
        summary: 'Something happened',
        recommendation: 'Do something',
      }),
    })

    const response = await route.POST(request)
    const payload = (await response.json()) as { code?: string }

    expect(response.status).toBe(403)
    expect(payload.code).toBe('INTERNAL_TOKEN_REQUIRED')
  })

  it('rejects internal ops actionable poll relay without internal token', async () => {
    const route = await import('@/app/api/internal/ops/actionable/poll-relay/route')
    const request = new Request('http://localhost/api/internal/ops/actionable/poll-relay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    const response = await route.POST(request)
    const payload = (await response.json()) as { code?: string }

    expect(response.status).toBe(403)
    expect(payload.code).toBe('INTERNAL_TOKEN_REQUIRED')
  })

  it('rejects approval patch without operator session', async () => {
    const route = await import('@/app/api/approvals/[id]/route')
    const request = new Request('http://localhost/api/approvals/ap_1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    })

    const response = await route.PATCH(request as unknown as import('next/server').NextRequest, {
      params: Promise.resolve({ id: 'ap_1' }),
    })
    const payload = (await response.json()) as { code?: string }

    expect(response.status).toBe(401)
    expect(payload.code).toBe('AUTH_REQUIRED')
  })
})
