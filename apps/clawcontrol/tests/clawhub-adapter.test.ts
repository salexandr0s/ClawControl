import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invalidateAsyncCache } from '@/lib/perf/async-cache'
import { createHttpClawHubAdapter } from '@/lib/clawhub/http-adapter'

describe('clawhub http adapter', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    invalidateAsyncCache()
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    invalidateAsyncCache()
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('uses /search when query is provided', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    const adapter = createHttpClawHubAdapter()
    const res = await adapter.searchSkills({ query: 'tavily', limit: 10 })

    expect(res.source).toBe('search')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/v1/search')
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('q=tavily')
  })

  it('caches getSkill responses', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          skill: {
            slug: 'gog',
            displayName: 'gog',
            summary: 'test',
            tags: { latest: '1.0.0' },
            stats: { comments: 0, downloads: 1, installsAllTime: 0, installsCurrent: 0, stars: 0, versions: 1 },
            createdAt: 0,
            updatedAt: 0,
          },
          latestVersion: { version: '1.0.0', createdAt: 0, changelog: '' },
          owner: null,
          moderation: { isSuspicious: false, isMalwareBlocked: false },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )

    const adapter = createHttpClawHubAdapter()
    const a = await adapter.getSkill('gog')
    const b = await adapter.getSkill('gog')

    expect(a.skill.slug).toBe('gog')
    expect(b.skill.slug).toBe('gog')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

