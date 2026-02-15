import 'server-only'

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const limit = Math.max(1, Math.floor(concurrency))
  const results = new Array<R>(items.length)

  let nextIndex = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = nextIndex
      nextIndex += 1
      if (idx >= items.length) return
      results[idx] = await mapper(items[idx], idx)
    }
  })

  await Promise.all(workers)
  return results
}

