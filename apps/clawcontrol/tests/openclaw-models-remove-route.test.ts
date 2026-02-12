import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  runCommandJson: vi.fn(),
  runDynamicCommand: vi.fn(),
  invalidateAsyncCache: vi.fn(),
}))

vi.mock('@clawcontrol/adapters-openclaw', () => ({
  runCommandJson: mocks.runCommandJson,
  runDynamicCommand: mocks.runDynamicCommand,
}))

vi.mock('@/lib/perf/async-cache', () => ({
  invalidateAsyncCache: mocks.invalidateAsyncCache,
}))

beforeEach(() => {
  vi.resetModules()
  mocks.runCommandJson.mockReset()
  mocks.runDynamicCommand.mockReset()
  mocks.invalidateAsyncCache.mockReset()
})

describe('openclaw models remove route', () => {
  it('removes a configured fallback model', async () => {
    mocks.runCommandJson.mockResolvedValue({
      data: {
        models: [
          { key: 'anthropic/opus', tags: ['fallback'] },
        ],
      },
      exitCode: 0,
    })
    mocks.runDynamicCommand.mockResolvedValue({
      exitCode: 0,
      durationMs: 10,
      stdout: '',
      stderr: '',
      timedOut: false,
    })

    const route = await import('@/app/api/openclaw/models/remove/route')
    const request = new NextRequest('http://localhost/api/openclaw/models/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'model', modelKey: 'anthropic/opus' }),
    })

    const response = await route.POST(request)
    const payload = await response.json() as {
      data: { modelKey: string; removedActions: number }
    }

    expect(response.status).toBe(200)
    expect(payload.data.modelKey).toBe('anthropic/opus')
    expect(payload.data.removedActions).toBe(1)
    expect(mocks.runDynamicCommand).toHaveBeenCalledWith(
      'models.fallbacks.remove',
      { model: 'anthropic/opus' }
    )
    expect(mocks.invalidateAsyncCache).toHaveBeenCalledWith('api.models.post:models.list.json')
  })

  it('blocks provider clear when provider contains the default model', async () => {
    mocks.runCommandJson.mockResolvedValue({
      data: {
        models: [
          { key: 'anthropic/claude-opus-4-5', tags: ['default'] },
          { key: 'anthropic/opus', tags: ['fallback'] },
        ],
      },
      exitCode: 0,
    })

    const route = await import('@/app/api/openclaw/models/remove/route')
    const request = new NextRequest('http://localhost/api/openclaw/models/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'provider', provider: 'anthropic' }),
    })

    const response = await route.POST(request)
    const payload = await response.json() as { error: string; code?: string }

    expect(response.status).toBe(409)
    expect(payload.code).toBe('PROVIDER_REMOVE_BLOCKED')
    expect(mocks.runDynamicCommand).not.toHaveBeenCalled()
  })

  it('clears removable provider model references', async () => {
    mocks.runCommandJson.mockResolvedValue({
      data: {
        models: [
          { key: 'anthropic/opus', tags: ['fallback'] },
          { key: 'anthropic/claude-sonnet-4-5', tags: ['alias:sonnet'] },
          { key: 'openai/gpt-5.2', tags: ['fallback'] },
        ],
      },
      exitCode: 0,
    })
    mocks.runDynamicCommand.mockResolvedValue({
      exitCode: 0,
      durationMs: 8,
      stdout: '',
      stderr: '',
      timedOut: false,
    })

    const route = await import('@/app/api/openclaw/models/remove/route')
    const request = new NextRequest('http://localhost/api/openclaw/models/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'provider', provider: 'anthropic' }),
    })

    const response = await route.POST(request)
    const payload = await response.json() as {
      data: { provider: string; removedModels: number; removedActions: number }
    }

    expect(response.status).toBe(200)
    expect(payload.data.provider).toBe('anthropic')
    expect(payload.data.removedModels).toBe(2)
    expect(payload.data.removedActions).toBe(2)
    expect(mocks.runDynamicCommand).toHaveBeenNthCalledWith(
      1,
      'models.fallbacks.remove',
      { model: 'anthropic/opus' }
    )
    expect(mocks.runDynamicCommand).toHaveBeenNthCalledWith(
      2,
      'models.aliases.remove',
      { alias: 'sonnet' }
    )
  })
})
