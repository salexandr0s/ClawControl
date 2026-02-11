import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getRepos: vi.fn(),
  enforceTypedConfirm: vi.fn(),
}))

vi.mock('@/lib/repo', () => ({
  getRepos: mocks.getRepos,
}))

vi.mock('@/lib/with-governor', () => ({
  enforceTypedConfirm: mocks.enforceTypedConfirm,
}))

describe('stations route lock', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.getRepos.mockReset()
    mocks.enforceTypedConfirm.mockReset()
  })

  it('blocks station create when mutations are disabled', async () => {
    delete process.env.CLAWCONTROL_ENABLE_STATION_MUTATIONS

    const route = await import('@/app/api/stations/route')
    const request = new NextRequest('http://localhost/api/stations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'custom', typedConfirmText: 'CONFIRM' }),
    })

    const response = await route.POST(request)
    const payload = (await response.json()) as { error?: string }

    expect(response.status).toBe(403)
    expect(payload.error).toBe('STATION_MUTATIONS_DISABLED')
    expect(mocks.enforceTypedConfirm).not.toHaveBeenCalled()
    expect(mocks.getRepos).not.toHaveBeenCalled()
  })

  it('blocks station update and delete when mutations are disabled', async () => {
    delete process.env.CLAWCONTROL_ENABLE_STATION_MUTATIONS

    const route = await import('@/app/api/stations/[id]/route')

    const patchRequest = new NextRequest('http://localhost/api/stations/build', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'build', typedConfirmText: 'CONFIRM' }),
    })
    const patchResponse = await route.PATCH(patchRequest, {
      params: Promise.resolve({ id: 'build' }),
    })
    const patchPayload = (await patchResponse.json()) as { error?: string }

    const deleteRequest = new NextRequest('http://localhost/api/stations/build', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ typedConfirmText: 'CONFIRM' }),
    })
    const deleteResponse = await route.DELETE(deleteRequest, {
      params: Promise.resolve({ id: 'build' }),
    })
    const deletePayload = (await deleteResponse.json()) as { error?: string }

    expect(patchResponse.status).toBe(403)
    expect(patchPayload.error).toBe('STATION_MUTATIONS_DISABLED')
    expect(deleteResponse.status).toBe(403)
    expect(deletePayload.error).toBe('STATION_MUTATIONS_DISABLED')
    expect(mocks.enforceTypedConfirm).not.toHaveBeenCalled()
    expect(mocks.getRepos).not.toHaveBeenCalled()
  })
})

