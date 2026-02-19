import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { proxy } from '@/proxy'

function makeRequest(
  pathname: string,
  init?: ConstructorParameters<typeof NextRequest>[1]
): NextRequest {
  return new NextRequest(`http://127.0.0.1:3000${pathname}`, init)
}

describe('proxy internal token guard', () => {
  it('rejects internal API mutations without internal token', async () => {
    const response = proxy(
      makeRequest('/api/internal/ops/actionable', {
        method: 'POST',
      })
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      code: 'INTERNAL_TOKEN_REQUIRED',
    })
  })

  it('allows internal API mutations with internal token', () => {
    const response = proxy(
      makeRequest('/api/internal/ops/actionable', {
        method: 'POST',
        headers: {
          'x-clawcontrol-internal-token': 'test-token',
        },
      })
    )

    expect(response.headers.get('x-middleware-next')).toBe('1')
  })

  it('still requires operator session for non-internal API mutations', async () => {
    const response = proxy(
      makeRequest('/api/work-orders/WO-123/start', {
        method: 'POST',
      })
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_REQUIRED',
    })
  })
})
