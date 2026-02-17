import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('security create/start work order contract', () => {
  it('keeps Create Work Order and adds Create + Start path with outcome visibility', async () => {
    const file = join(
      process.cwd(),
      'app',
      '(dashboard)',
      'security',
      'security-client.tsx'
    )
    const source = await readFile(file, 'utf8')

    expect(source).toContain('Create Work Order')
    expect(source).toContain('Create + Start')
    expect(source).toContain("createWorkOrder('create_and_start')")
    expect(source).toContain('Work order created, but start failed:')
    expect(source).toContain('Open work order')
  })
})
