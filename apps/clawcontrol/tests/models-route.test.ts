import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  runCommandJson: vi.fn(),
  getOrLoadWithCache: vi.fn(),
  invalidateAsyncCache: vi.fn(),
}))

vi.mock('@clawcontrol/adapters-openclaw', () => ({
  runCommandJson: mocks.runCommandJson,
}))

vi.mock('@/lib/perf/route-timing', () => ({
  withRouteTiming: (_name: string, handler: unknown) => handler,
}))

vi.mock('@/lib/perf/async-cache', () => ({
  getOrLoadWithCache: mocks.getOrLoadWithCache,
  invalidateAsyncCache: mocks.invalidateAsyncCache,
}))

beforeEach(() => {
  vi.resetModules()
  mocks.runCommandJson.mockReset()
  mocks.getOrLoadWithCache.mockReset()
  mocks.invalidateAsyncCache.mockReset()

  mocks.getOrLoadWithCache.mockImplementation(async (_key, _ttl, loader) => ({
    value: await loader(),
    cacheHit: false,
    sharedInFlight: false,
  }))
})

describe('models route', () => {
  it('classifies CLI unavailable errors on GET', async () => {
    mocks.runCommandJson.mockResolvedValue({
      error: 'OpenClaw CLI not found',
      exitCode: 127,
    })

    const route = await import('@/app/api/models/route')
    const response = await route.GET()
    const payload = await response.json() as { error: string; code?: string; fixHint?: string }

    expect(response.status).toBe(500)
    expect(payload.error).toContain('Failed to get model status')
    expect(payload.code).toBe('CLI_UNAVAILABLE')
    expect(payload.fixHint).toContain('Install OpenClaw')
  })

  it('classifies parse failures when JSON payload is missing on POST', async () => {
    mocks.runCommandJson.mockResolvedValue({
      data: undefined,
      error: undefined,
      exitCode: 0,
    })

    const route = await import('@/app/api/models/route')
    const request = new NextRequest('http://localhost/api/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status' }),
    })
    const response = await route.POST(request)
    const payload = await response.json() as { error: string; code?: string; fixHint?: string }

    expect(response.status).toBe(500)
    expect(payload.error).toContain('Failed to parse JSON output')
    expect(payload.code).toBe('CLI_JSON_PARSE_FAILED')
    expect(payload.fixHint).toContain('non-JSON output')
  })
})
