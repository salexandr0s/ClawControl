import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('dashboard active work orders navigation', () => {
  it('routes active work order rows to work-orders page with openWorkOrderId query', async () => {
    const file = join(
      process.cwd(),
      'app',
      '(dashboard)',
      'dashboard',
      'dashboard.tsx'
    )
    const source = await readFile(file, 'utf8')

    expect(source).toContain('openWorkOrderId=')
    expect(source).toContain('row.workOrderId')
    expect(source).toContain('onRowClick')
    expect(source).toContain('router.push')
  })
})
