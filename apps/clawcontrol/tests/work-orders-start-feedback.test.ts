import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('work orders start feedback behavior', () => {
  it('uses id-based drawer selection and derives selected work order from live list', async () => {
    const file = join(
      process.cwd(),
      'app',
      '(dashboard)',
      'work-orders',
      'work-orders-client.tsx'
    )
    const source = await readFile(file, 'utf8')

    expect(source).toContain('selectedWorkOrderId')
    expect(source).toContain('setSelectedWorkOrderId(wo.id)')
    expect(source).toContain('workOrders.find((workOrder) => workOrder.id === selectedWorkOrderId)')
  })

  it('shows running/success/failure start feedback and refreshes after failed start', async () => {
    const file = join(
      process.cwd(),
      'app',
      '(dashboard)',
      'work-orders',
      'work-orders-client.tsx'
    )
    const source = await readFile(file, 'utf8')

    expect(source).toContain('Start requested. Waiting for manager dispatch...')
    expect(source).toContain('Workflow started successfully.')
    expect(source).toContain('Start failed:')
    expect(source).toMatch(/catch[\s\S]{0,500}await fetchWorkOrders\(\)/)
  })

  it('supports dashboard deep-link query to open a work order drawer', async () => {
    const file = join(
      process.cwd(),
      'app',
      '(dashboard)',
      'work-orders',
      'work-orders-client.tsx'
    )
    const source = await readFile(file, 'utf8')

    expect(source).toContain("useSearchParams")
    expect(source).toContain("searchParams.get('openWorkOrderId')")
    expect(source).toContain('setDrawerOpen(true)')
    expect(source).toContain("setView('board')")
  })

  it('keeps archived available in state filters', async () => {
    const file = join(
      process.cwd(),
      'app',
      '(dashboard)',
      'work-orders',
      'work-orders-client.tsx'
    )
    const source = await readFile(file, 'utf8')

    expect(source).toContain("'archived'")
    expect(source).toContain('Archive column shows archived and cancelled')
  })
})
