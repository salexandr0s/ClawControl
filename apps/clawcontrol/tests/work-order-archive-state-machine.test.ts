import { describe, expect, it } from 'vitest'
import {
  canTransitionWorkOrder,
  getValidWorkOrderTransitions,
  isWorkOrderTerminal,
  validateWorkOrderTransition,
} from '@clawcontrol/core'

describe('work order archive state machine', () => {
  it('allows shipped -> archived transition', () => {
    expect(canTransitionWorkOrder('shipped', 'archived')).toBe(true)
    expect(getValidWorkOrderTransitions('shipped')).toContain('archived')

    const validation = validateWorkOrderTransition('shipped', 'archived')
    expect(validation.valid).toBe(true)
  })

  it('treats archived as terminal', () => {
    expect(isWorkOrderTerminal('archived')).toBe(true)
    expect(getValidWorkOrderTransitions('archived')).toEqual([])
  })
})
