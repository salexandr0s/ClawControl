import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('work orders archive/cancel actions contract', () => {
  it('includes archived in work-order filters and exposes drawer archive action for shipped', async () => {
    const file = join(
      process.cwd(),
      'app',
      '(dashboard)',
      'work-orders',
      'work-orders-client.tsx'
    )
    const source = await readFile(file, 'utf8')

    expect(source).toContain("'archived'")
    expect(source).toContain('onArchive={handleArchiveWorkOrder}')
    expect(source).toContain("workOrder.state === 'shipped'")
    expect(source).toContain("'Archiving...'")
  })

  it('shows archive button and state-action error visibility on full detail page', async () => {
    const file = join(
      process.cwd(),
      'app',
      '(dashboard)',
      'work-orders',
      '[id]',
      'work-order-detail.tsx'
    )
    const source = await readFile(file, 'utf8')

    expect(source).toContain("const canArchive = allowedTransitions.includes('archived')")
    expect(source).toContain('<Archive className="w-3.5 h-3.5" />')
    expect(source).toContain('Archive failed:')
    expect(source).toContain('Cancel failed:')
    expect(source).toContain('Ship failed:')
  })
})
