import { describe, expect, it } from 'vitest'
import { getOrLoadWithCache, invalidateAsyncCache } from '@/lib/perf/async-cache'

describe('async-cache', () => {
  it('returns cached values within ttl', async () => {
    invalidateAsyncCache()
    let calls = 0

    const first = await getOrLoadWithCache('k', 10_000, async () => {
      calls += 1
      return { value: 42 }
    })
    const second = await getOrLoadWithCache('k', 10_000, async () => {
      calls += 1
      return { value: 7 }
    })

    expect(calls).toBe(1)
    expect(first.value.value).toBe(42)
    expect(second.value.value).toBe(42)
    expect(second.cacheHit).toBe(true)
  })

  it('coalesces concurrent loads for same key', async () => {
    invalidateAsyncCache()
    let calls = 0

    const [a, b, c] = await Promise.all([
      getOrLoadWithCache('shared', 10_000, async () => {
        calls += 1
        await new Promise((resolve) => setTimeout(resolve, 15))
        return 'ok'
      }),
      getOrLoadWithCache('shared', 10_000, async () => {
        calls += 1
        return 'bad'
      }),
      getOrLoadWithCache('shared', 10_000, async () => {
        calls += 1
        return 'bad'
      }),
    ])

    expect(calls).toBe(1)
    expect(a.value).toBe('ok')
    expect(b.value).toBe('ok')
    expect(c.value).toBe('ok')
    expect(b.sharedInFlight || c.sharedInFlight).toBe(true)
  })
})
