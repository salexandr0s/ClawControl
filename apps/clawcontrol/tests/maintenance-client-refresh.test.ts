import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('maintenance client refresh behavior', () => {
  it('wires gateway-status refresh button to status refresh, not health execution', async () => {
    const file = join(
      process.cwd(),
      'app',
      '(dashboard)',
      'maintenance',
      'maintenance-client.tsx'
    )
    const source = await readFile(file, 'utf8')

    expect(source).toMatch(/onClick=\{\(\) => void refreshStatus\(\)\}[\s\S]{0,400}Refresh Status/)
  })
})
