import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

describe('favorites-store', () => {
  const originalHome = process.env.OPENCLAW_HOME
  let tempHome = ''

  beforeEach(async () => {
    tempHome = join(tmpdir(), `openclaw-test-${randomUUID()}`)
    await fsp.mkdir(tempHome, { recursive: true })
    process.env.OPENCLAW_HOME = tempHome
    vi.resetModules()
  })

  afterEach(() => {
    process.env.OPENCLAW_HOME = originalHome
  })

  it('adds, toggles, and removes favorites with normalized paths', async () => {
    const mod = await import('@/lib/workspace/favorites-store')

    let data = await mod.mutateFavorites('add', '/memory/2026-02-06.md')
    expect(data.favorites).toContain('/memory/2026-02-06.md')

    data = await mod.mutateFavorites('toggle', '/memory/2026-02-06.md')
    expect(data.favorites).not.toContain('/memory/2026-02-06.md')

    data = await mod.mutateFavorites('add', '/memory/2026-02-06.md')
    data = await mod.mutateFavorites('remove', '/memory/2026-02-06.md')
    expect(data.favorites).toEqual([])
  })

  it('caps recents to 50 entries', async () => {
    const mod = await import('@/lib/workspace/favorites-store')

    for (let i = 0; i < 55; i++) {
      await mod.touchRecent(`/memory/2026-02-${String((i % 28) + 1).padStart(2, '0')}.md`)
    }

    const data = await mod.readWorkspaceFavorites()
    expect(data.recents.length).toBeLessThanOrEqual(50)
  })
})
