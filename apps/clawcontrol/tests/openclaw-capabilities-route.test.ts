import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getOpenClawCapabilities: vi.fn(),
  clearCapabilitiesCache: vi.fn(),
  clearOpenClawCheckCache: vi.fn(),
  getOpenClawBin: vi.fn(),
}))

vi.mock('@/lib/openclaw', () => ({
  getOpenClawCapabilities: mocks.getOpenClawCapabilities,
  clearCapabilitiesCache: mocks.clearCapabilitiesCache,
}))

vi.mock('@clawcontrol/adapters-openclaw', () => ({
  clearCache: mocks.clearOpenClawCheckCache,
  getOpenClawBin: mocks.getOpenClawBin,
}))

beforeEach(() => {
  vi.resetModules()
  mocks.getOpenClawCapabilities.mockReset()
  mocks.clearCapabilitiesCache.mockReset()
  mocks.clearOpenClawCheckCache.mockReset()
  mocks.getOpenClawBin.mockReset()

  mocks.getOpenClawBin.mockReturnValue('/usr/local/bin/openclaw')
})

describe('openclaw capabilities route', () => {
  it('clears both capability and resolve-bin caches on refresh=1', async () => {
    mocks.getOpenClawCapabilities.mockResolvedValue({
      version: '1.2.3',
      available: true,
      resolvedBin: '/usr/local/bin/openclaw',
      plugins: {
        supported: true,
        listJson: true,
        infoJson: true,
        doctor: true,
        install: true,
        enable: true,
        disable: true,
        uninstall: true,
        setConfig: true,
      },
      sources: { cli: true, http: false },
      probedAt: new Date('2026-02-11T00:00:00.000Z'),
    })

    const route = await import('@/app/api/openclaw/capabilities/route')
    const req = new NextRequest('http://localhost/api/openclaw/capabilities?refresh=1')
    const res = await route.GET(req)
    const payload = await res.json() as { meta: { refreshed: boolean }; data: { available: boolean } }

    expect(res.status).toBe(200)
    expect(payload.meta.refreshed).toBe(true)
    expect(payload.data.available).toBe(true)
    expect(mocks.clearCapabilitiesCache).toHaveBeenCalledTimes(1)
    expect(mocks.clearOpenClawCheckCache).toHaveBeenCalledTimes(1)
  })

  it('returns a degraded payload with resolved bin when probing throws', async () => {
    mocks.getOpenClawCapabilities.mockRejectedValue(new Error('probe failed'))

    const route = await import('@/app/api/openclaw/capabilities/route')
    const req = new NextRequest('http://localhost/api/openclaw/capabilities')
    const res = await route.GET(req)
    const payload = await res.json() as { data: { available: boolean; resolvedBin: string; degradedReason: string } }

    expect(res.status).toBe(500)
    expect(payload.data.available).toBe(false)
    expect(payload.data.resolvedBin).toBe('/usr/local/bin/openclaw')
    expect(payload.data.degradedReason).toContain('probe failed')
  })
})
