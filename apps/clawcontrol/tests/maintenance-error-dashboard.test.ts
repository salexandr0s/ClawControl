import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('maintenance error dashboard behavior', () => {
  it('keeps Create Work Order as primary and Create + Start as secondary action', async () => {
    const file = join(
      process.cwd(),
      'app',
      '(dashboard)',
      'maintenance',
      'maintenance-client.tsx'
    )
    const source = await readFile(file, 'utf8')

    expect(source).toMatch(/variant="primary"[\s\S]{0,600}Create Work Order/)
    expect(source).toMatch(/variant="secondary"[\s\S]{0,600}Create \+ Start/)
  })

  it('supports sanitized/raw evidence toggle and copy controls', async () => {
    const file = join(
      process.cwd(),
      'app',
      '(dashboard)',
      'maintenance',
      'maintenance-client.tsx'
    )
    const source = await readFile(file, 'utf8')

    expect(source).toContain('includeRawEvidence')
    expect(source).toContain('drawerIncludeRawEvidence')
    expect(source).toContain('setDrawerIncludeRawEvidence')
    expect(source).toContain('Raw (Redacted)')
    expect(source).toContain('CopyButton')
    expect(source).toContain('rawRedactedSample')
  })

  it('wires suggested fix actions to maintenance execution path', async () => {
    const file = join(
      process.cwd(),
      'app',
      '(dashboard)',
      'maintenance',
      'maintenance-client.tsx'
    )
    const source = await readFile(file, 'utf8')

    expect(source).toContain('Run Suggested Fix')
    expect(source).toContain('runSuggestedMaintenanceAction')
    expect(source).toContain('handleAction(maintenanceAction)')
  })

  it('keeps primary action buttons aligned and places optional suggested fix on a secondary row', async () => {
    const file = join(
      process.cwd(),
      'app',
      '(dashboard)',
      'maintenance',
      'maintenance-client.tsx'
    )
    const source = await readFile(file, 'utf8')

    expect(source).toContain('flex flex-col items-end gap-1.5 shrink-0')
    expect(source).toContain("Create Work Order")
    expect(source).toContain("Create + Start")
    expect(source).toContain('CopyButton text={evidenceText}')
    expect(source).toContain('{hasMaintenanceSuggestion ? (')
    expect(source).toContain('Run Suggested Fix')
  })
})
