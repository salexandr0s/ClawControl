import { describe, expect, it } from 'vitest'
import {
  KANBAN_COLUMNS,
  groupByState,
  resolveDropTargetState,
  validateKanbanDrop,
} from '@/lib/kanban-helpers'

describe('kanban archive mapping contract', () => {
  it('uses archived as archive column state', () => {
    const archiveColumn = KANBAN_COLUMNS.find((column) => column.label === 'Archive')
    expect(archiveColumn?.state).toBe('archived')
  })

  it('groups archived and cancelled cards into Archive column bucket', () => {
    const grouped = groupByState([
      { id: 'wo_1', state: 'archived' as const },
      { id: 'wo_2', state: 'cancelled' as const },
      { id: 'wo_3', state: 'blocked' as const },
    ])

    expect(grouped.archived.map((item) => item.id)).toEqual(['wo_1', 'wo_2'])
    expect(grouped.cancelled).toEqual([])
    expect(grouped.blocked.map((item) => item.id)).toEqual(['wo_3'])
  })

  it('resolves drop-to-archive by source state', () => {
    expect(resolveDropTargetState('shipped', 'archived')).toBe('archived')
    expect(resolveDropTargetState('blocked', 'archived')).toBe('cancelled')
  })

  it('marks blocked->archive as protected cancel and shipped->archive as non-protected archive', () => {
    const blockedDrop = validateKanbanDrop('blocked', 'archived')
    expect(blockedDrop.valid).toBe(true)
    expect(blockedDrop.requiresConfirmation).toBe(true)
    expect(blockedDrop.actionKind).toBe('work_order.cancel')

    const shippedDrop = validateKanbanDrop('shipped', 'archived')
    expect(shippedDrop.valid).toBe(true)
    expect(shippedDrop.requiresConfirmation).toBe(false)
  })
})
