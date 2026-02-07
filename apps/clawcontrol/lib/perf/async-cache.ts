type CacheEntry = {
  value: unknown
  expiresAt: number
}

const ttlCache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<unknown>>()

export function invalidateAsyncCache(key?: string): void {
  if (key) {
    ttlCache.delete(key)
    inFlight.delete(key)
    return
  }
  ttlCache.clear()
  inFlight.clear()
}

export async function getOrLoadWithCache<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>
): Promise<{ value: T; cacheHit: boolean; sharedInFlight: boolean }> {
  const now = Date.now()
  const cached = ttlCache.get(key)
  if (cached && cached.expiresAt > now) {
    return {
      value: cached.value as T,
      cacheHit: true,
      sharedInFlight: false,
    }
  }

  const currentInFlight = inFlight.get(key)
  if (currentInFlight) {
    const value = await currentInFlight
    return {
      value: value as T,
      cacheHit: false,
      sharedInFlight: true,
    }
  }

  const nextPromise = loader()
  inFlight.set(key, nextPromise)

  try {
    const value = await nextPromise
    ttlCache.set(key, {
      value,
      expiresAt: Date.now() + Math.max(0, ttlMs),
    })
    return {
      value,
      cacheHit: false,
      sharedInFlight: false,
    }
  } finally {
    inFlight.delete(key)
  }
}
