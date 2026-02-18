import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('memory page contract', () => {
  it('supports week/month/year calendar controls and excludes day mode', async () => {
    const file = join(
      process.cwd(),
      'app',
      '(dashboard)',
      'memory',
      'memory-client.tsx'
    )

    const source = await readFile(file, 'utf8')

    expect(source).toContain("type MemoryCalendarView = 'week' | 'month' | 'year'")
    expect(source).toContain("(['week', 'month', 'year'] as const)")
    expect(source).not.toContain("(['day', 'week', 'month', 'year'] as const)")
    expect(source).not.toContain("calendarView === 'day'")
    expect(source).not.toContain("setCalendarView('day')")
  })
})
